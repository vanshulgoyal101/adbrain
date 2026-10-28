/**
 * Records real Graph insights and ad review reads for the test:core results refresh
 * fixture (#258). Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-results-fixtures.ts <live-campaign-id> <paused-campaign-id>
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
  if ((init?.method ?? "GET") !== "GET") throw new Error("Results recorder is read-only.");
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
  if (ids.length !== 2) throw new Error("Pass a live and a paused campaign ID.");
  for (const id of ids) {
    const insights = await meta.getCampaignInsights(id);
    const review = await meta.readAdReview(id);
    console.log(`${id}: ${insights.impressions} impressions, ${review.map(ad => `${ad.adId}=${ad.state}`).join(", ")}`);
  }
  if (JSON.stringify(tape).includes("access_token")) throw new Error("Token leaked into the tape.");
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/results.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`results: ${tape.length} exchanges`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
