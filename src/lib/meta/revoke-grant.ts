import { metaWriteMode } from "@/lib/internal-accounts";
import { recordProductEvent } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { MetaClient, MetaError } from "./client";
import { decryptMetaToken, fromPostgresBytea } from "./token-store";

export type RevokeOutcome = "revoked" | "already" | "skipped_shared" | "skipped_system" | "skipped_none" | "unavailable" | "failed";

type Target = { token_id: string; subject_id: string; token_kind: string; shared: boolean };

/**
 * #1649 (#1648, CTO): best effort, before a disconnect purges the token, revoke the app's grant at Meta
 * (`DELETE /{user}/permissions`). Only for a user token whose Meta user connects no other live business, because the
 * grant is app-wide for that person; never for a business system user; never for the smoke account (pause-only).
 * Never throws and never blocks the disconnect; the outcome is logged with a code, never the token.
 */
export async function revokeMetaGrant(businessId: string): Promise<RevokeOutcome> {
  const outcome = await attempt(businessId).catch((): { result: RevokeOutcome; code?: string } => ({ result: "failed", code: "UNEXPECTED" }));
  recordProductEvent({
    kind: "workflow", name: "meta.revoke", businessId,
    outcome: outcome.result === "revoked" || outcome.result === "already" ? "success" : outcome.result === "failed" ? "failed" : "rejected",
    attributes: { provider: "meta", errorCode: outcome.code ?? outcome.result.toUpperCase() },
  });
  return outcome.result;
}

async function attempt(businessId: string): Promise<{ result: RevokeOutcome; code?: string }> {
  const admin = createAdminClient();
  // Read-only lookup added with #1648's purge migration: this business's token, its Meta user and kind, and whether
  // another live connection uses the same Meta user. Until it ships, nothing is revoked.
  const lookup = await (admin.rpc as unknown as (name: string, args: object) => Promise<{ data: Target[] | null; error: { code?: string } | null }>)(
    "meta_token_revocation_target", { p_business_id: businessId });
  if (lookup.error) return { result: lookup.error.code === "PGRST202" ? "unavailable" : "failed", code: lookup.error.code === "PGRST202" ? "RPC_UNAVAILABLE" : "LOOKUP_FAILED" };
  const target = lookup.data?.[0];
  if (!target) return { result: "skipped_none" };
  if (target.token_kind !== "user") return { result: "skipped_system" };
  if (target.shared) return { result: "skipped_shared" };

  const [tokens, connection, business] = await Promise.all([
    admin.rpc("meta_token_get", { p_token_id: target.token_id, p_business_id: businessId }),
    admin.from("meta_connections").select("ad_account_id, page_id").eq("business_id", businessId).maybeSingle(),
    admin.from("businesses").select("owner_id").eq("id", businessId).maybeSingle(),
  ]);
  const row = tokens.data?.[0];
  const ownerId = (business.data as { owner_id?: string } | null)?.owner_id;
  if (tokens.error || !row || row.revoked_at || !ownerId) return { result: "failed", code: "TOKEN_UNAVAILABLE" };
  const accessToken = decryptMetaToken({
    ciphertext: fromPostgresBytea(row.ciphertext), nonce: fromPostgresBytea(row.nonce), authTag: fromPostgresBytea(row.auth_tag),
    keyId: row.key_id, formatVersion: row.format_version,
  }, { tokenId: row.id, businessId: row.business_id });
  const assets = connection.data as { ad_account_id?: string | null; page_id?: string | null } | null;
  const meta = new MetaClient({ adAccountId: assets?.ad_account_id ?? "", pageId: assets?.page_id ?? "", accessToken }, undefined,
    metaWriteMode(ownerId, assets?.ad_account_id));
  try {
    await meta.revokeGrant(target.subject_id);
    return { result: "revoked" };
  } catch (error) {
    // 190: the token no longer works, so the grant is already gone (or will lapse with it).
    if (error instanceof MetaError && error.code === 190) return { result: "already" };
    return { result: "failed", code: error instanceof MetaError && error.code ? `META_${error.code}` : "META_UNREACHABLE" };
  }
}
