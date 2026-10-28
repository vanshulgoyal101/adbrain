/**
 * #1305: records Meta's real review feedback for a campaign's ads, read-only (any non-GET Graph call is refused
 * before it leaves the process), through `MetaClient.readAdReview`, so the core test replays the client's own read.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-ad-review.ts <metaCampaignId>
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
const OUT = join(process.cwd(), "tests/core/fixtures/meta/ad-review.json");
const campaignId = process.argv[2];
if (!campaignId) throw new Error("Pass the Meta campaign id that has a rejected ad.");
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
  const reviews = await client.readAdReview(campaignId);
  const { scrub } = metaScrubber();
  const fixture = JSON.parse(scrub(JSON.stringify({ recordedAt: new Date().toISOString(), campaignId, tape, reviews })));
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`recorded ${tape.length} exchanges; ${reviews.filter((review) => review.state === "rejected").length} rejected ad(s)`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
