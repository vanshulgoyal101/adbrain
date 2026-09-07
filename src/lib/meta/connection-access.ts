import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MetaClient, type MetaCredentials } from "./client";
import {
  capabilitiesSchema,
  type AttemptDTO,
  type ConnectionBinding,
  type ConnectionDTO,
  type ConnectionPurpose,
} from "./connect-contracts";
import { decryptMetaToken, fromPostgresBytea } from "./token-store";
import { verifyMetaCapabilities } from "./capability-verification";
import { canUseMetaConnect } from "./pilot-access";

const authorizedBusinessBrand = Symbol("authorized-business");

export type AuthorizedBusiness = {
  readonly businessId: string;
  readonly userId: string;
  readonly [authorizedBusinessBrand]: true;
};

export class ConnectionAccessError extends Error {
  readonly code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNAVAILABLE";

  constructor(code: ConnectionAccessError["code"], message: string) {
    super(message);
    this.name = "ConnectionAccessError";
    this.code = code;
  }
}

function isAuthorizedBusiness(value: AuthorizedBusiness): boolean {
  return Boolean(value && value[authorizedBusinessBrand] === true);
}

/** Authenticate the session and prove ownership before any Meta access. */
export async function requireOwnedBusiness(
  businessId: string,
): Promise<AuthorizedBusiness> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ConnectionAccessError("UNAUTHENTICATED", "Sign in required.");

  if (!canUseMetaConnect(user.id)) throw new ConnectionAccessError("FORBIDDEN", "Meta connection is not enabled for this account.");

  const { data: business, error } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw new ConnectionAccessError("UNAVAILABLE", "Business access could not be checked.");
  if (!business) throw new ConnectionAccessError("NOT_FOUND", "Business not found.");
  if (business.owner_id !== user.id) {
    throw new ConnectionAccessError("FORBIDDEN", "Business access is not allowed.");
  }

  return {
    businessId: business.id,
    userId: user.id,
    [authorizedBusinessBrand]: true,
  };
}

export async function getConnectionStatus(
  context: AuthorizedBusiness,
): Promise<ConnectionDTO> {
  if (!isAuthorizedBusiness(context)) {
    throw new ConnectionAccessError("FORBIDDEN", "Authorized business context required.");
  }
  const { data, error } = await createAdminClient()
    .from("meta_connections")
    .select("business_id, generation, authorization_status, meta_business_id, ad_account_id, page_id, account_name, page_name, currency, timezone_name, capabilities, last_checked_at")
    .eq("business_id", context.businessId)
    .maybeSingle();
  if (error) throw new ConnectionAccessError("UNAVAILABLE", "Meta connection status is unavailable.");
  const selected = data?.ad_account_id && data.page_id
    ? {
        metaBusinessId: data.meta_business_id,
        adAccountId: data.ad_account_id,
        accountName: data.account_name ?? "Meta ad account",
        pageId: data.page_id,
        pageName: data.page_name ?? "Facebook Page",
        currency: data.currency ?? "INR",
        timezoneName: data.timezone_name ?? "Unknown",
      }
    : null;
  const capabilities = data?.capabilities;
  return {
    businessId: context.businessId,
    generation: data?.generation ?? 0,
    authorization: data?.authorization_status ?? "disconnected",
    selected,
    capabilities: capabilitiesSchema.safeParse(capabilities).success
      ? capabilitiesSchema.parse(capabilities)
      : {
          canReadInsights: { state: "unknown", blockers: [] },
          canReadLeads: { state: "unknown", blockers: [] },
          canCreatePaused: { state: "unknown", blockers: [] },
          canActivate: { state: "unknown", blockers: [] },
        },
    checkedAt: data?.last_checked_at ?? null,
  };
}

export async function withMetaConnection<Result>(
  context: AuthorizedBusiness,
  options: {
    purpose: ConnectionPurpose;
    binding?: ConnectionBinding;
    expectedGeneration?: number;
  },
  execute: (client: MetaClient, connection: ConnectionDTO) => Promise<Result>,
): Promise<Result> {
  return withConnectionCredentials(context, options, (credentials, connection) => execute(new MetaClient(credentials), connection));
}

async function withConnectionCredentials<Result>(
  context: AuthorizedBusiness,
  options: { purpose: ConnectionPurpose | "verify"; binding?: ConnectionBinding; expectedGeneration?: number },
  execute: (credentials: MetaCredentials, connection: ConnectionDTO) => Promise<Result>,
): Promise<Result> {
  if (!isAuthorizedBusiness(context)) {
    throw new ConnectionAccessError("FORBIDDEN", "Authorized business context required.");
  }
  const connection = await getConnectionStatus(context);
  if (connection.authorization !== "connected" || !connection.selected) {
    throw new ConnectionAccessError("UNAVAILABLE", "Meta is not connected for this business.");
  }
  if (options.expectedGeneration !== undefined && options.expectedGeneration !== connection.generation) {
    throw new ConnectionAccessError("CONFLICT", "Meta connection changed; review again.");
  }
  if (options.binding && (
    options.binding.adAccountId !== connection.selected.adAccountId ||
    options.binding.pageId !== connection.selected.pageId
  )) {
    throw new ConnectionAccessError("CONFLICT", "Campaign Meta assets no longer match the connection.");
  }
  const reducingDelivery = options.purpose === "pause" || options.purpose === "delete";
  if (reducingDelivery && (!options.binding || options.expectedGeneration === undefined)) {
    throw new ConnectionAccessError("FORBIDDEN", "Original campaign binding is required.");
  }
  const capability = connection.capabilities[
    options.purpose === "read_insights"
      ? "canReadInsights"
      : options.purpose === "read_leads"
        ? "canReadLeads"
        : options.purpose === "create_paused"
          ? "canCreatePaused"
          : "canActivate"
  ];
  if (options.purpose !== "verify" && !reducingDelivery && capability.state !== "available") {
    throw new ConnectionAccessError(
      "UNAVAILABLE",
      capability.blockers[0]?.message ?? "Meta has not confirmed access for this operation.",
    );
  }
  const admin = createAdminClient();
  const { data: connectionRow, error: connectionError } = await admin
    .from("meta_connections")
    .select("token_id, generation, ad_account_id, page_id, authorization_status")
    .eq("business_id", context.businessId)
    .maybeSingle();
  if (connectionError || !connectionRow || connectionRow.generation !== connection.generation
    || connectionRow.authorization_status !== "connected"
    || connectionRow.ad_account_id !== connection.selected.adAccountId
    || connectionRow.page_id !== connection.selected.pageId) {
    throw new ConnectionAccessError("CONFLICT", "Meta connection changed; review again.");
  }
  const { data: tokenRows, error: tokenError } = connectionRow?.token_id
    ? await admin.rpc("meta_token_get", {
        p_token_id: connectionRow.token_id,
        p_business_id: context.businessId,
      })
    : { data: [], error: null };
  const row = tokenRows?.[0];
  if (tokenError || !row || row.revoked_at
    || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
    || (row.data_access_expires_at && new Date(row.data_access_expires_at).getTime() <= Date.now())) {
    throw new ConnectionAccessError("UNAVAILABLE", "Meta credentials are unavailable.");
  }
  if (reducingDelivery && !row.granted_scopes.includes("ads_management")) {
    throw new ConnectionAccessError("UNAVAILABLE", "Meta campaign management permission is required.");
  }
  const token = decryptMetaToken({
    ciphertext: fromPostgresBytea(row.ciphertext),
    nonce: fromPostgresBytea(row.nonce),
    authTag: fromPostgresBytea(row.auth_tag),
    keyId: row.key_id,
    formatVersion: row.format_version,
  }, { tokenId: row.id, businessId: row.business_id });
  const credentials: MetaCredentials = {
    adAccountId: connection.selected.adAccountId,
    pageId: connection.selected.pageId,
    accessToken: token,
  };
  return execute(credentials, connection);
}

export async function recheckMetaConnection(context: AuthorizedBusiness, expectedGeneration: number): Promise<ConnectionDTO> {
  return withConnectionCredentials(context, { purpose: "verify", expectedGeneration }, async (credentials, connection) => {
    const capabilities = await verifyMetaCapabilities(credentials.accessToken, connection.selected!);
    const checkedAt = new Date().toISOString();
    const storedCapabilities = {
      canReadInsights: { ...capabilities.canReadInsights, blockers: [...capabilities.canReadInsights.blockers] },
      canReadLeads: { ...capabilities.canReadLeads, blockers: [...capabilities.canReadLeads.blockers] },
      canCreatePaused: { ...capabilities.canCreatePaused, blockers: [...capabilities.canCreatePaused.blockers] },
      canActivate: { ...capabilities.canActivate, blockers: [...capabilities.canActivate.blockers] },
    };
    const { data, error } = await createAdminClient().from("meta_connections")
      .update({ capabilities: storedCapabilities, last_checked_at: checkedAt })
      .eq("business_id", context.businessId).eq("generation", expectedGeneration)
      .eq("authorization_status", "connected").select("business_id").maybeSingle();
    if (error || !data) throw new ConnectionAccessError("CONFLICT", "Meta connection changed during verification.");
    return { ...connection, capabilities, checkedAt };
  });
}

export async function getOwnedConnectionAttempt(attemptId: string): Promise<AttemptDTO> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ConnectionAccessError("UNAUTHENTICATED", "Sign in required.");
  if (!canUseMetaConnect(user.id)) throw new ConnectionAccessError("FORBIDDEN", "Meta connection is not enabled for this account.");
  const { getConnectionAttempt } = await import("./connection-repository");
  const attempt = await getConnectionAttempt(attemptId, user.id);
  if (!attempt) throw new ConnectionAccessError("NOT_FOUND", "Connection attempt not found.");
  return attempt;
}

export async function requireScheduledBusiness(
  businessId: string,
  request: Request,
): Promise<AuthorizedBusiness> {
  const secret = getEnv().CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ConnectionAccessError("FORBIDDEN", "Verified scheduler context required.");
  }
  const supabase = createAdminClient();
  const { data: business, error } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !business) {
    throw new ConnectionAccessError("NOT_FOUND", "Business not found.");
  }
  return {
    businessId: business.id,
    userId: business.owner_id,
    [authorizedBusinessBrand]: true,
  };
}