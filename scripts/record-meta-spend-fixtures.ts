/**
 * Records real Graph lifetime-spend reads for the test:core cost evidence
 * fixture (#216). Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-spend-fixtures.ts <undelivered-campaign-id> <spent-campaign-id>
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID; tokens are stripped.
 */
import "./lib/meta-write-gate";
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
  if ((init?.method ?? "GET") !== "GET") throw new Error("Spend recorder is read-only.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace("/v26.0/", "") + parsed.search, status: response.status, body });
  return response;
};

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const ids = process.argv.slice(2);
  if (ids.length !== 2) throw new Error("Pass an undelivered and a spent campaign ID.");
  for (const id of ids) console.log(`${id}: ${await meta.readLifetimeSpendPaise(id)} paise`);
  if (JSON.stringify(tape).includes("access_token")) throw new Error("Token leaked into the tape.");
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/lifetime-spend.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`lifetime-spend: ${tape.length} exchanges`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
