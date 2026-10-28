/**
 * #783: records Meta's real answers for per-ad results, read-only (any non-GET Graph call is refused before it
 * leaves the process). Picks a campaign on the account where some ads delivered and at least one didn't, then
 * records `getAdResults` and the campaign total (`getCampaignInsights`) so the core test can check the sum.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/record-meta-ad-results.ts [campaignId]
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens and the WhatsApp number are scrubbed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const OUT = join(process.cwd(), "tests/core/fixtures/meta/ad-results.json");
let tape: Exchange[] = [];
const realFetch = globalThis.fetch;

function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/access_token=[^&"\s]+/g, "access_token=REDACTED");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === "access_token" ? "REDACTED" : key === "whatsapp_phone_number" ? "910000000000" : scrub(item)]));
  return value;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Read-only recorder: refusing a Graph write.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace("/v26.0/", "") + parsed.search, status: response.status, body: scrub(body) });
  return response;
};

async function graph<T>(path: string): Promise<T> {
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  return realFetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`).then(response => response.json()) as Promise<T>;
}

async function pick(): Promise<string> {
  const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
  const campaigns = await graph<{ data: Array<{ id: string; name: string }> }>(`${account}/campaigns?fields=id,name&limit=100`);
  for (const campaign of campaigns.data) {
    const [ads, rows] = await Promise.all([
      graph<{ data?: unknown[] }>(`${campaign.id}/ads?fields=id&limit=100`),
      graph<{ data?: unknown[] }>(`${campaign.id}/insights?level=ad&fields=ad_id&date_preset=maximum&limit=100`),
    ]);
    const adCount = ads.data?.length ?? 0, delivered = rows.data?.length ?? 0;
    console.log(`${campaign.id} ads=${adCount} delivered=${delivered} ${campaign.name}`);
    if (delivered >= 1 && adCount > delivered) return campaign.id;
  }
  throw new Error("No campaign with both delivering and undelivered ads.");
}

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const campaignId = process.argv[2] ?? await pick();
  tape = [];
  const ads = await meta.getAdResults(campaignId);
  const total = await meta.getCampaignInsights(campaignId);
  writeFileSync(OUT, `${JSON.stringify({ recordedAt: new Date().toISOString(), campaignId, tape }, null, 2)}\n`);
  console.log(JSON.stringify({ campaignId, ads: ads.map(ad => ({ id: ad.adId, delivered: ad.delivered, results: ad.results, spend: ad.spend })), total: { spend: total.spend, conversations: total.conversations, leads: total.leads } }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
