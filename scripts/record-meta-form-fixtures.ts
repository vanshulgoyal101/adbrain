/**
 * Records real Graph single lead-form reads for the test:core preflight form check (#271).
 * Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-form-fixtures.ts <active-form-id> <other-object-id> <unknown-id>
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID; tokens are stripped.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Form recorder is read-only.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (body && "access_token" in body) body.access_token = "REDACTED";
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace("/v26.0/", "") + parsed.search, status: response.status, body });
  return response;
};

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const ids = process.argv.slice(2);
  if (ids.length !== 3) throw new Error("Pass an active form ID, another object's ID and an unknown ID.");
  for (const id of ids) console.log(`${id}: ${JSON.stringify(await meta.readActiveLeadForm(id))}`);
  if (/EAA[A-Za-z0-9]{20,}/.test(JSON.stringify(tape))) throw new Error("Token leaked into the tape.");
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/lead-form.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`lead-form: ${tape.length} exchanges`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
