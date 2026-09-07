import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types";
import {
  attemptDtoSchema,
  capabilitiesSchema,
  connectionDtoSchema,
  type AttemptDTO,
  type ConnectIntent,
} from "./connect-contracts";
import {
  encryptMetaToken,
  toPostgresBytea,
  type EncryptedMetaToken,
} from "./token-store";

export const META_ATTEMPT_TTL_MS = 10 * 60_000;

export function hashConnectionSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createBrowserBinding(): string {
  return randomUUID().replaceAll("-", "");
}

export async function createConnectionAttempt(input: {
  businessId: string;
  userId: string;
  intent: ConnectIntent;
  state: string;
  browserBinding: string;
  expectedGeneration: number;
}): Promise<{ attemptId: string; expiresAt: string }> {
  const attemptId = randomUUID();
  const expiresAt = new Date(Date.now() + META_ATTEMPT_TTL_MS).toISOString();
  const { error } = await createAdminClient().rpc("meta_attempt_create", {
    p_id: attemptId,
    p_business_id: input.businessId,
    p_user_id: input.userId,
    p_state_hash: hashConnectionSecret(input.state),
    p_browser_binding_hash: hashConnectionSecret(input.browserBinding),
    p_status: "authorizing",
    p_intent: input.intent,
    p_expected_generation: input.expectedGeneration,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error("Meta connection attempt could not be created.");
  return { attemptId, expiresAt };
}

export async function claimConnectionAttempt(input: {
  state: string;
  browserBinding: string;
  userId: string;
}): Promise<{ attemptId: string; businessId: string; userId: string; status: string } | null> {
  const { data: rows, error } = await createAdminClient().rpc("meta_attempt_claim", {
    p_state_hash: hashConnectionSecret(input.state),
    p_user_id: input.userId,
    p_browser_binding_hash: hashConnectionSecret(input.browserBinding),
  });
  if (error || !rows?.length) return null;
  const row = rows[0];
  return { attemptId: row.attempt_id, businessId: row.business_id, userId: row.user_id, status: row.status };
}

export async function markAttemptDiscovering(attemptId: string, retry = false): Promise<void> {
  const { data, error } = await createAdminClient().rpc("meta_attempt_set_discovering", {
    p_attempt_id: attemptId,
    p_retry: retry,
  });
  if (error || data !== true) throw new Error("Meta connection attempt could not be updated.");
}

export async function markAttemptActionRequired(
  attemptId: string,
  discoverySnapshot: Json,
): Promise<void> {
  await markAttemptDiscoveryResult(attemptId, discoverySnapshot, "action_required", "SETUP_REQUIRED");
}

export async function markAttemptDiscoveryResult(
  attemptId: string,
  discoverySnapshot: Json,
  status: "selection_required" | "action_required",
  errorCode: string | null,
): Promise<void> {
  const { data, error } = await createAdminClient().rpc("meta_attempt_discovery_result", {
    p_attempt_id: attemptId,
    p_discovered_assets: discoverySnapshot,
    p_status: status,
    p_error_code: errorCode,
  });
  if (error || data !== true) throw new Error("Meta discovery result could not be recorded.");
}

export async function attachAttemptToken(attemptId: string, tokenId: string): Promise<void> {
  const { data, error } = await createAdminClient().rpc("meta_attempt_attach_token", {
    p_attempt_id: attemptId,
    p_token_id: tokenId,
  });
  if (error || data !== true) throw new Error("Meta token could not be linked to the connection attempt.");
}

export async function markAttemptFailed(
  attemptId: string,
  errorCode: string,
): Promise<void> {
  const { data, error } = await createAdminClient().rpc("meta_attempt_failed", {
    p_attempt_id: attemptId,
    p_error_code: errorCode,
  });
  if (error || data !== true) throw new Error("Meta connection attempt failure could not be recorded.");
}

export async function markAttemptCancelled(attemptId: string): Promise<void> {
  const { data, error } = await createAdminClient().rpc("meta_attempt_cancelled", {
    p_attempt_id: attemptId,
  });
  if (error || data !== true) throw new Error("Meta connection cancellation could not be recorded.");
}

export async function commitSelectedConnection(input: {
  attemptId: string;
  userId: string;
  pairId: string;
  revision: number;
  confirmReplacement: boolean;
}): Promise<AttemptDTO | null> {
  const { data: committed, error } = await createAdminClient().rpc("meta_attempt_commit_selection", {
    p_attempt_id: input.attemptId,
    p_user_id: input.userId,
    p_pair_id: input.pairId,
    p_revision: input.revision,
    p_confirm_replacement: input.confirmReplacement,
  });
  if (error || committed !== true) return null;
  const attempt = await getConnectionAttempt(input.attemptId, input.userId);
  if (attempt?.connection) {
    const { requireOwnedBusiness, recheckMetaConnection } = await import("./connection-access");
    const context = await requireOwnedBusiness(attempt.businessId);
    await recheckMetaConnection(context, attempt.connection.generation).catch(() => undefined);
  }
  return getConnectionAttempt(input.attemptId, input.userId);
}

export async function getConnectionAttempt(
  attemptId: string,
  userId: string,
): Promise<AttemptDTO | null> {
  const { data: rows, error } = await createAdminClient().rpc("meta_attempt_get", {
    p_attempt_id: attemptId,
    p_user_id: userId,
  });
  const data = rows?.[0];
  if (error || !data) return null;
  const expired = new Date(data.expires_at).getTime() <= Date.now();
  const state = expired && !["connected", "failed", "cancelled"].includes(data.status)
    ? "expired"
    : data.status;
  const snapshot = data.discovered_assets;
  const candidates = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot.candidates
    : snapshot;
  const storedCandidates = Array.isArray(candidates)
    ? candidates.filter(
        (candidate): candidate is { [key: string]: Json } =>
          Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate) && "pairId" in candidate),
      )
    : [];
  const { data: connectionRow } = await createAdminClient()
    .from("meta_connections")
    .select("business_id, generation, authorization_status, meta_business_id, ad_account_id, page_id, account_name, page_name, currency, timezone_name, capabilities, last_checked_at")
    .eq("business_id", data.business_id)
    .maybeSingle();
  const connection = connectionRow
    ? connectionDtoSchema.safeParse({
        businessId: data.business_id,
        generation: connectionRow.generation,
        authorization: connectionRow.authorization_status,
        selected: connectionRow.ad_account_id && connectionRow.page_id
          ? {
              metaBusinessId: connectionRow.meta_business_id,
              adAccountId: connectionRow.ad_account_id,
              accountName: connectionRow.account_name ?? "Meta ad account",
              pageId: connectionRow.page_id,
              pageName: connectionRow.page_name ?? "Facebook Page",
              currency: connectionRow.currency ?? "INR",
              timezoneName: connectionRow.timezone_name ?? "Unknown",
            }
          : null,
        capabilities: capabilitiesSchema.safeParse(connectionRow.capabilities).success
          ? connectionRow.capabilities
          : {
              canReadInsights: { state: "unknown", blockers: [] },
              canReadLeads: { state: "unknown", blockers: [] },
              canCreatePaused: { state: "unknown", blockers: [] },
              canActivate: { state: "unknown", blockers: [] },
            },
        checkedAt: connectionRow.last_checked_at,
      })
    : null;
  const dto = {
    attemptId: data.id,
    businessId: data.business_id,
    intent: data.intent,
    expiresAt: data.expires_at,
    revision: data.revision,
    state,
    discoveryComplete: Boolean(data.discovery_complete),
    candidates: storedCandidates,
    connection: connection?.success ? connection.data : null,
    blockers: data.error_code
      ? [{ code: data.error_code, message: "Meta connection needs attention.", action: null }]
      : [],
    retryAfterMs: null,
  };
  const parsed = attemptDtoSchema.safeParse(dto);
  return parsed.success ? parsed.data : null;
}

export async function saveEncryptedMetaToken(input: {
  businessId: string;
  userId: string;
  subjectId: string;
  token: string;
  expiresAt: string | null;
  dataAccessExpiresAt?: string | null;
  scopes: string[];
  grantedAssets: Json[];
}): Promise<string> {
  const tokenId = randomUUID();
  const encrypted: EncryptedMetaToken = encryptMetaToken(input.token, {
    tokenId,
    businessId: input.businessId,
  });
  const { data, error } = await createAdminClient().rpc("meta_token_insert", {
    p_id: tokenId,
    p_business_id: input.businessId,
    p_authorized_by: input.userId,
    p_subject_id: input.subjectId,
    p_token_kind: "user",
    p_ciphertext: toPostgresBytea(encrypted.ciphertext),
    p_nonce: toPostgresBytea(encrypted.nonce),
    p_auth_tag: toPostgresBytea(encrypted.authTag),
    p_key_id: encrypted.keyId,
    p_format_version: encrypted.formatVersion,
    p_granted_scopes: input.scopes,
    p_granted_assets: input.grantedAssets,
    p_expires_at: input.expiresAt,
    p_validated_at: new Date().toISOString(),
    p_data_access_expires_at: input.dataAccessExpiresAt ?? null,
  });
  if (error || data !== tokenId) throw new Error("Meta token could not be stored.");
  return tokenId;
}