import { createAdminClient } from "@/lib/supabase/admin";
import { MetaClient, type MetaCredentials } from "./client";
import { decryptMetaToken, fromPostgresBytea } from "./token-store";

/** Non-sensitive view of a business's Meta connection, safe to send to the UI. */
export interface MetaConnection {
  source: "oauth" | "env" | "none";
  /** An OAuth connection exists but no ad account / page has been chosen yet. */
  pending: boolean;
  /** A complete connection ready to run campaigns. */
  ready: boolean;
  adAccountId: string | null;
  pageId: string | null;
  tokenExpiresAt: string | null;
  expired: boolean;
  scopes: string[];
}

interface ConnectionRow {
  business_id: string;
  token_id: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  account_name: string | null;
  page_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  authorization_status: string;
  generation: number;
  last_checked_at: string | null;
  capabilities: unknown;
}

async function getConnectionRow(businessId: string): Promise<ConnectionRow | null> {
  const { data, error } = await createAdminClient()
    .from("meta_connections")
    .select("business_id, token_id, ad_account_id, page_id, account_name, page_name, currency, timezone_name, authorization_status, generation, last_checked_at, capabilities")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("Meta connection storage could not be read.");
  return (data as ConnectionRow | null) ?? null;
}

async function getEncryptedToken(row: ConnectionRow): Promise<string | null> {
  if (!row.token_id || row.authorization_status !== "connected") return null;
  const { data: rows, error } = await createAdminClient().rpc("meta_token_get", {
    p_token_id: row.token_id,
    p_business_id: row.business_id,
  });
  const data = rows?.[0];
  if (error || !data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (data.data_access_expires_at && new Date(data.data_access_expires_at).getTime() <= Date.now()) return null;
  try {
    return decryptMetaToken({
      ciphertext: fromPostgresBytea(data.ciphertext),
      nonce: fromPostgresBytea(data.nonce),
      authTag: fromPostgresBytea(data.auth_tag),
      keyId: data.key_id,
      formatVersion: data.format_version,
    }, { tokenId: data.id, businessId: data.business_id });
  } catch {
    return null;
  }
}

/**
 * Resolve only the explicit business's stored credentials. Missing, pending,
 * expired, or unreadable credentials fail closed; environment credentials are
 * never a tenant fallback.
 */
export async function resolveMetaCredentials(
  businessId: string,
  _db?: unknown,
): Promise<MetaCredentials | null> {
  void _db;
  const row = await getConnectionRow(businessId);
  const accessToken = row ? await getEncryptedToken(row) : null;
  if (
    row &&
    accessToken &&
    row.ad_account_id &&
    row.page_id &&
    row.authorization_status === "connected"
  ) {
    return {
      adAccountId: row.ad_account_id,
      pageId: row.page_id,
      accessToken,
    };
  }
  return null;
}

/** A MetaClient bound to a business's resolved credentials, or null if none. */
export async function metaClientForBusiness(
  businessId: string,
  db?: unknown,
): Promise<MetaClient | null> {
  const creds = await resolveMetaCredentials(businessId, db);
  return creds ? new MetaClient(creds) : null;
}

/** Connection status for the settings UI (never includes the token). */
export async function getMetaConnection(
  businessId: string,
): Promise<MetaConnection> {
  const row = await getConnectionRow(businessId);
  const accessToken = row ? await getEncryptedToken(row) : null;

  if (row && ["reauth_required", "revoked"].includes(row.authorization_status)) {
    return { source: "oauth", pending: false, ready: false, adAccountId: row.ad_account_id, pageId: row.page_id, tokenExpiresAt: null, expired: true, scopes: [] };
  }
  if (row?.authorization_status === "connected") {
    const expired = !accessToken;
    const complete = Boolean(row.ad_account_id && row.page_id);
    return {
      source: "oauth",
      pending: !complete,
      ready: complete && !expired,
      adAccountId: row.ad_account_id,
      pageId: row.page_id,
      tokenExpiresAt: null,
      expired,
      scopes: [],
    };
  }

  return {
    source: "none",
    pending: false,
    ready: false,
    adAccountId: null,
    pageId: null,
    tokenExpiresAt: null,
    expired: false,
    scopes: [],
  };
}

/** Whether a business can run Meta campaigns right now. */
export async function isMetaReadyForBusiness(
  businessId: string,
): Promise<boolean> {
  return (await getMetaConnection(businessId)).ready;
}
