import { createAdminClient } from "@/lib/supabase/admin";
import { getConnectionAttempt, markAttemptDiscoveryResult, markAttemptFailed } from "./connection-repository";
import { decryptMetaToken, fromPostgresBytea } from "./token-store";
import { discoverMetaAssets } from "./oauth";
import { buildCandidateDTOs, buildDiscoveryPairs, decideSelection } from "./selection";

export async function retryConnectionDiscovery(attemptId: string, userId: string, revision: number) {
  const admin = createAdminClient();
  const { data: claimed, error } = await admin.rpc("meta_attempt_retry_claim", {
    p_attempt_id: attemptId, p_user_id: userId, p_revision: revision,
  });
  if (error || !claimed) return null;
  let credentialReady = false;
  try {
    const { data: attempts, error: attemptError } = await admin.rpc("meta_attempt_get", { p_attempt_id: attemptId, p_user_id: userId });
    const attempt = attempts?.[0];
    if (attemptError || !attempt?.token_id || attempt.status !== "discovering") throw new Error("Reauthorization required.");
    const { data: tokens, error: tokenError } = await admin.rpc("meta_token_get", { p_token_id: attempt.token_id, p_business_id: attempt.business_id });
    const token = tokens?.[0];
    if (tokenError || !token || token.revoked_at || [token.expires_at, token.data_access_expires_at].some(expiry => expiry && new Date(expiry).getTime() <= Date.now())) throw new Error("Reauthorization required.");
    const accessToken = decryptMetaToken({
      ciphertext: fromPostgresBytea(token.ciphertext), nonce: fromPostgresBytea(token.nonce),
      authTag: fromPostgresBytea(token.auth_tag), keyId: token.key_id, formatVersion: token.format_version,
    }, { tokenId: token.id, businessId: token.business_id });
    credentialReady = true;
    const discovery = await discoverMetaAssets(accessToken);
    const pairs = buildDiscoveryPairs({ ...discovery, supportedCurrencies: ["INR"] });
    const candidates = buildCandidateDTOs(pairs);
    const decision = decideSelection({ complete: discovery.complete, pairs });
    const status = ["choose", "auto_link"].includes(decision.kind) ? "selection_required" : "action_required";
    await markAttemptDiscoveryResult(attemptId, JSON.parse(JSON.stringify({ kind: "asset_snapshot", ...discovery, candidates })), status,
      !discovery.complete ? "DISCOVERY_INCOMPLETE" : status === "action_required" ? "SETUP_REQUIRED" : null);
  } catch {
    await markAttemptFailed(attemptId, credentialReady ? "DISCOVERY_INCOMPLETE" : "REAUTH_REQUIRED");
  }
  return getConnectionAttempt(attemptId, userId);
}