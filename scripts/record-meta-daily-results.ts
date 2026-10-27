/**
 * #1022: records Meta's real one-day per-ad results (`MetaClient.getAdResults(id, { day })`) for a
 * live campaign, for test:core: the daily WhatsApp line must use the same numbers as #783's card.
 * GETs only: any other method is refused before it leaves the process. Tokens are dropped.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-daily-results.ts <campaignId> <YYYY-MM-DD>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";

const [campaignId, day] = process.argv.slice(2);
if (!campaignId || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) throw new Error("Pass a campaign id and a day (YYYY-MM-DD).");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;

type Exchange = { path: string; status: number; body: unknown };
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if ((init?.method ?? "GET") !== "GET") throw new Error(`Recorder refuses ${init?.method}.`);
  const url = new URL(String(input));
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
  tape.push({ path, status: response.status, body: JSON.parse(text.replace(/"access_token":"[^"]+"/g, "\"access_token\":\"page-token\"")) });
  console.log(response.status, decodeURIComponent(path).slice(0, 160));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const ads = await new MetaClient({ adAccountId, pageId, accessToken: token }).getAdResults(campaignId, { day });
  console.log(ads.map((ad) => ({ id: ad.adId, spend: ad.spend, results: ad.results, opens: ad.whatsappOpens })));
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/daily-results.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), campaignId, day, tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
