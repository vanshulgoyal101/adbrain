import { NextResponse } from "next/server";
import { managedAccountsEnabledFor } from "@/lib/meta/managed-account";
import { currentRequestId } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";

export function managedFail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 || status === 409 && code === "PROVISIONING_IN_PROGRESS" }, requestId: currentRequestId() }, { status });
}

/**
 * One gate for every managed route (Reviewer #625): managed accounts on for this user (#523), signed in,
 * and Meta Connect open to them, checked in that order so a disabled feature stays a 404.
 */
export async function managedRouteUser(): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!managedAccountsEnabledFor(user)) return { ok: false, response: managedFail(404, "NOT_ENABLED", "Managed accounts are not enabled.") };
  if (!user) return { ok: false, response: managedFail(401, "UNAUTHENTICATED", "Sign in required.") };
  if (!canUseMetaConnect(user.id)) return { ok: false, response: managedFail(403, "FORBIDDEN", "Meta connection is not enabled for this account.") };
  return { ok: true, userId: user.id };
}

export type ManagedAttempt = { businessId: string; userId: string; snapshot: unknown; tokenId: string | null };

/**
 * #523/#521 (2-Tier): the caller's own Meta connection attempt, checked as Connect does (QA #537):
 * managed accounts on, signed in, the attempt is theirs and not expired, and they still own its business.
 */
export async function ownedManagedAttempt(attemptId: string): Promise<{ ok: true; attempt: ManagedAttempt } | { ok: false; response: NextResponse }> {
  const gate = await managedRouteUser();
  if (!gate.ok) return gate;
  const { data, error } = await createAdminClient().rpc("meta_attempt_get", { p_attempt_id: attemptId, p_user_id: gate.userId });
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
  return { ok: true, attempt: { businessId: attempt.business_id, userId: gate.userId, snapshot: attempt.discovered_assets as unknown, tokenId: attempt.token_id ?? null } };
}
