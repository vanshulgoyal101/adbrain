/**
 * Records real Graph reads for the test:core settle fixture (#221): whether Meta
 * confirms a campaign's whole tree stopped, and its lifetime spend. Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-stop-fixtures.ts <campaign-id>...
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID; tokens are stripped.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v21.0/";
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Stop recorder is read-only.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace("/v21.0/", "") + parsed.search, status: response.status, body });
  return response;
};

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("Pass one or more campaign IDs.");
  for (const id of ids) {
    console.log(`${id}: stopped=${await meta.readCampaignStopped(id)} spend=${await meta.readLifetimeSpendPaise(id)} paise`);
  }
  if (JSON.stringify(tape).includes("access_token")) throw new Error("Token leaked into the tape.");
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/campaign-stop.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`campaign-stop: ${tape.length} exchanges`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
