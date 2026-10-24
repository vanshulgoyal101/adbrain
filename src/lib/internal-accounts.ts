import internal from "./internal-accounts.json";

export type AccountIdentity = { id: string; email?: string | null; email_confirmed_at?: string | null } | null | undefined;

/** Team, owner and test accounts (#379, #398). A team domain counts only once the email is confirmed. */
export function isInternalUser(user: AccountIdentity): boolean {
  if (!user) return false;
  if (internal.userIds.includes(user.id)) return true;
  const domain = user.email?.trim().toLowerCase().split("@")[1];
  return Boolean(domain && user.email_confirmed_at && internal.domains.includes(domain));
}
