import internal from "./internal-accounts.json";

export type AccountIdentity = { id: string; email?: string | null; email_confirmed_at?: string | null } | null | undefined;

/** Team, owner and test accounts (#379, #398). A team domain counts only once the email is confirmed. */
export function isInternalUser(user: AccountIdentity): boolean {
  if (!user) return false;
  if (internal.userIds.includes(user.id)) return true;
  const domain = user.email?.trim().toLowerCase().split("@")[1];
  return Boolean(domain && user.email_confirmed_at && internal.domains.includes(domain));
}

/** Internal accounts that still use the paid models (#466): each entry says why. */
export function isExemptFromFreeProviders(user: AccountIdentity): boolean {
  return Boolean(user && internal.exemptFromFreeProviders.some((entry) => entry.userId === user.id));
}

/** #1317: a sales prospect's account: an internal team address with `+prospect` (docs/operations/runbooks/prospect-handover.md). */
export function isProspectAccount(user: AccountIdentity): boolean {
  const local = user?.email?.trim().toLowerCase().split("@")[0] ?? "";
  return isInternalUser(user) && /\+prospect(?:-|$)/.test(local);
}

/**
 * #1324: the smoke/demo login is connected to a real ad account. A business it owns may read, validate and pause
 * on Meta, but nothing else, unless its ad account is a listed test account.
 */
export function metaWriteMode(ownerId: string, adAccountId: string | null | undefined): "all" | "pause-only" {
  if (!internal.smokeUserIds.includes(ownerId)) return "all";
  return adAccountId && (internal.testAdAccountIds as string[]).includes(adAccountId) ? "all" : "pause-only";
}

/**
 * #1467: accounts that aren't customers or the team's own walks, left out of every scoreboard row: the production
 * smoke, the demo workspace and sales prospects (`+prospect`, #1317).
 */
export function isScoreboardExcluded(user: AccountIdentity, demoEmail?: string | null): boolean {
  if (!user) return false;
  if (internal.smokeUserIds.includes(user.id)) return true;
  if (demoEmail && user.email?.trim().toLowerCase() === demoEmail.trim().toLowerCase()) return true;
  return isProspectAccount(user);
}
