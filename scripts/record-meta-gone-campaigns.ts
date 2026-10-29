/**
 * #2268: records Meta's real list of the ad account's deleted/archived campaigns, read-only (any non-GET Graph call is
 * refused before it leaves the process), through `MetaClient.listGoneCampaigns`, so the core test replays the client's
 * own read. Sync uses it to end stored rows Meta's plain listing leaves out.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-gone-campaigns.ts
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Ids, phone numbers and tokens are scrubbed.
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";
import { metaScrubber } from "./lib/scrub-meta";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/";
const OUT = join(process.cwd(), "tests/core/fixtures/meta/campaigns-gone.json");
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Read-only recorder: refusing a Graph write.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace(/^\/v\d+\.\d+\//, "") + parsed.search, status: response.status, body });
  return response;
};

async function main() {
  const client = metaClientFromEnv();
  if (!client) throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and META_PAGE_ID.");
  const gone = await client.listGoneCampaigns();
  const { scrub } = metaScrubber();
  const fixture = JSON.parse(scrub(JSON.stringify({ recordedAt: new Date().toISOString(), tape })));
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`recorded ${tape.length} exchange(s); ${gone.size} gone campaign(s)`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
