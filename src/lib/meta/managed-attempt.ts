import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { currentRequestId } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";

export function managedFail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 || status === 409 && code === "PROVISIONING_IN_PROGRESS" }, requestId: currentRequestId() }, { status });
}

export type ManagedAttempt = { businessId: string; userId: string; snapshot: unknown; tokenId: string | null };

/**
 * #523/#521 (2-Tier): the caller's own Meta connection attempt, checked as Connect does (QA #537):
 * managed accounts on, signed in, the attempt is theirs and not expired, and they still own its business.
 */
export async function ownedManagedAttempt(attemptId: string): Promise<{ ok: true; attempt: ManagedAttempt } | { ok: false; response: NextResponse }> {
  if (!getEnv().MANAGED_ACCOUNTS_ENABLED) return { ok: false, response: managedFail(404, "NOT_ENABLED", "Managed accounts are not enabled.") };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: managedFail(401, "UNAUTHENTICATED", "Sign in required.") };
  if (!canUseMetaConnect(user.id)) return { ok: false, response: managedFail(403, "FORBIDDEN", "Meta connection is not enabled for this account.") };
  const { data, error } = await createAdminClient().rpc("meta_attempt_get", { p_attempt_id: attemptId, p_user_id: user.id });
  const attempt = data?.[0];
  if (error || !attempt) return { ok: false, response: managedFail(404, "NOT_FOUND", "Connection attempt not found.") };
  // An expired attempt's Page rights may be stale, and the business must still be the caller's.
  if (new Date(attempt.expires_at).getTime() <= Date.now()) {
    return { ok: false, response: managedFail(410, "ATTEMPT_EXPIRED", "This Facebook connection has expired. Connect Facebook again to choose your Page.") };
  }
  try {
    await requireOwnedBusiness(attempt.business_id);
  } catch {
    return { ok: false, response: managedFail(404, "NOT_FOUND", "Connection attempt not found.") };
  }
  return { ok: true, attempt: { businessId: attempt.business_id, userId: user.id, snapshot: attempt.discovered_assets as unknown, tokenId: attempt.token_id ?? null } };
}
