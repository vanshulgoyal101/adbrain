/**
 * #1022: records Meta's real one-day per-ad results (`MetaClient.getAdResults(id, { day })`) for a
 * live campaign, for test:core: the daily WhatsApp line must use the same numbers as #783's card.
 * GETs only: any other method is refused before it leaves the process. Tokens are dropped and every
 * real identifier is replaced before writing: ids (10+ digits: account, Page, WhatsApp phone id,
 * campaign, ad set, ad, creative) become stable fake numbers, a WhatsApp number keeps only its last 4
 * digits, and paging cursors are dropped.
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
const fakes = new Map<string, string>();
/** The same real id always maps to the same fake one, so the replayed reads still join up. */
const fake = (id: string) => {
  if (!fakes.has(id)) fakes.set(id, `9${String(fakes.size + 1).padStart(id.length - 1, "0")}`);
  return fakes.get(id)!;
};
function scrub(text: string): string {
  return text
    .replace(/"whatsapp_phone_number":"\+?(\d+)"/g, (_all, digits: string) => `"whatsapp_phone_number":"+91XXXXXX${digits.slice(-4)}"`)
    .replace(/"(before|after)":"[^"]+"/g, '"$1":"CURSOR"')
    .replace(/\d{10,}/g, fake);
}
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if ((init?.method ?? "GET") !== "GET") throw new Error(`Recorder refuses ${init?.method}.`);
  const url = new URL(String(input));
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  const path = scrub(url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search);
  tape.push({ path, status: response.status, body: JSON.parse(scrub(text.replace(/"access_token":"[^"]+"/g, "\"access_token\":\"page-token\""))) });
  console.log(response.status, decodeURIComponent(path).slice(0, 160));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const ads = await new MetaClient({ adAccountId, pageId, accessToken: token }).getAdResults(campaignId, { day });
  console.log(ads.map((ad) => ({ id: ad.adId, spend: ad.spend, results: ad.results, opens: ad.whatsappOpens })));
  const creds = { adAccountId: `act_${fake(adAccountId.replace(/^act_/, ""))}`, pageId: fake(pageId) };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/daily-results.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), campaignId: fake(campaignId), day, creds, tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
