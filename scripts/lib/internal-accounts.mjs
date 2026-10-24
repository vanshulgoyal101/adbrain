// Internal accounts (#379): the one definition of "not a real customer" for every number we
// report. Add a new internal account here, by domain or by user id (never by email: this repo
// is public). The smoke and demo emails come from the owner's local .env.smoke at run time.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

export const INTERNAL_DOMAINS = ["adbrain.vanshul.com", "adbrain.local"];

/** Owner and team accounts outside INTERNAL_DOMAINS, by auth user id. */
export const INTERNAL_USER_IDS = [
  "da0771ca-c07f-4e86-b6da-023aaf517d74", // owner (Solaride, the live #157 run)
];

const quote = (value) => `'${String(value).trim().toLowerCase().replaceAll("'", "''")}'`;
const list = (values, type) => `array[${values.map(quote).join(",")}]::${type}[]`;

/** SQL boolean: is the auth.users row `alias` internal? `emails` are extra local emails (smoke, demo). */
export function isInternalUserSql(alias, emails) {
  const email = `lower(coalesce(${alias}.email, ''))`;
  return `(split_part(${email}, '@', 2) = any(${list(INTERNAL_DOMAINS, "text")})`
    + ` or ${alias}.id = any(${list(INTERNAL_USER_IDS, "uuid")})`
    + ` or ${email} = any(${list(emails, "text")}))`;
}

export function internalUserIdsSql(emails) {
  return `select u.id from auth.users u where ${isInternalUserSql("u", emails)}`;
}

const smokeEnvPath = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";

/** The smoke and demo emails from the owner's .env.smoke, or from the environment. */
export async function localInternalEmails() {
  const emails = [process.env.SMOKE_EMAIL, process.env.DEMO_USER_EMAIL];
  try {
    const env = parseEnv(await readFile(smokeEnvPath, "utf8"));
    emails.push(env.SMOKE_EMAIL, env.DEMO_USER_EMAIL);
  } catch {
    // Domains and ids still apply; the smoke account is on an internal domain today.
  }
  return [...new Set(emails.filter(Boolean).map((email) => email.trim().toLowerCase()))];
}
