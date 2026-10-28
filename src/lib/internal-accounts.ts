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

/** #1317: a sales prospect's account: an internal team address with `+prospect` (docs/OPERATIONS.md, Prospect accounts). */
export function isProspectAccount(user: AccountIdentity): boolean {
  const local = user?.email?.trim().toLowerCase().split("@")[0] ?? "";
  return isInternalUser(user) && /\+prospect(?:-|$)/.test(local);
}
