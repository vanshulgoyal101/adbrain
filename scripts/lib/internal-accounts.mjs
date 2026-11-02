// Internal accounts (#379, #398): the one definition of "not a real customer". The list lives in
// src/lib/internal-accounts.json, shared with the app (no monthly AI limit for these accounts).
// Add a domain or an auth user id there, never an email: this repo is public. The smoke and demo
// emails come from the owner's local .env.smoke at run time.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import internal from "../../src/lib/internal-accounts.json" with { type: "json" };

export const INTERNAL_DOMAINS = internal.domains;
export const INTERNAL_USER_IDS = internal.userIds;

/**
 * #2145: would this signed-in user's Create make free pictures? The same rule as the app's `freeImagesOnly()`
 * (src/lib/llm/spend-policy.ts): internal (listed id, or a confirmed team-domain email) and not exempt.
 */
export function makesFreePictures(user) {
  if (!user?.id) return false;
  const domain = user.email?.trim().toLowerCase().split("@")[1];
  const isInternal = internal.userIds.includes(user.id) || Boolean(domain && user.email_confirmed_at && internal.domains.includes(domain));
  return isInternal && !internal.exemptFromFreeProviders.some((entry) => entry.userId === user.id);
}

const quote = (value) => `'${String(value).trim().toLowerCase().replaceAll("'", "''")}'`;
const list = (values, type) => `array[${values.map(quote).join(",")}]::${type}[]`;

/**
 * #2538: reserved test domains (RFC 2606/6761) can't be a customer's: retired team logins are renamed to them.
 * Reports only; the app's internal rule (spend, free pictures) stays the JSON list.
 */
const RESERVED_TEST_DOMAIN = String.raw`'(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$'`;

/** SQL boolean: is the auth.users row `alias` internal? `emails` are extra local emails (every test login). */
export function isInternalUserSql(alias, emails) {
  const email = `lower(coalesce(${alias}.email, ''))`;
  return `(split_part(${email}, '@', 2) = any(${list(INTERNAL_DOMAINS, "text")})`
    + ` or split_part(${email}, '@', 2) ~ ${RESERVED_TEST_DOMAIN}`
    + ` or ${alias}.id = any(${list(INTERNAL_USER_IDS, "uuid")})`
    + ` or ${email} = any(${list(emails, "text")}))`;
}

export function internalUserIdsSql(emails) {
  return `select u.id from auth.users u where ${isInternalUserSql("u", emails)}`;
}

const smokeEnvPath = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";

/** #2538: every test login lives in .env.smoke (AGENTS.md), each as `<NAME>_EMAIL`. */
export function testLoginEmails(env) {
  return Object.entries(env).filter(([key, value]) => key.endsWith("_EMAIL") && value?.includes("@")).map(([, value]) => value);
}

/** Every test login's email (`*_EMAIL`) in the owner's .env.smoke (#2538), plus smoke and demo from the environment. */
export async function localInternalEmails() {
  const emails = [process.env.SMOKE_EMAIL, process.env.DEMO_USER_EMAIL];
  try {
    const env = parseEnv(await readFile(smokeEnvPath, "utf8"));
    emails.push(...testLoginEmails(env));
  } catch {
    // Domains and ids still apply; the smoke account is on an internal domain today.
  }
  return [...new Set(emails.filter(Boolean).map((email) => email.trim().toLowerCase()))];
}

/** SQL boolean: a row belongs to a real customer, by its user or, for background rows, its business owner. */
export function customerFilterSql(userColumn, businessColumn, emails) {
  return `coalesce(${userColumn}, (select b.owner_id from public.businesses b where b.id = ${businessColumn})) not in (${internalUserIdsSql(emails)})`;
}
