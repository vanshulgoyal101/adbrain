/**
 * #1045: records Meta's real answers for pausing one ad (`MetaClient.setAdStatus`), for test:core.
 * Changes nothing: the live ad is only validated (execution_options=["validate_only"]), and the real
 * write goes to an ad that is already PAUSED (a no-op Meta still answers and reads back). Any other
 * POST is refused before it leaves the process. The tape is scrubbed (scripts/lib/scrub-meta.ts).
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-ad-pause.ts <campaignId> <liveAdId> <pausedAdId>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";
import { metaScrubber } from "./lib/scrub-meta";

const [campaignId, liveAdId, pausedAdId] = process.argv.slice(2);
if (!pausedAdId) throw new Error("Pass the campaign, a live ad and an already-paused ad of that campaign.");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;

type Exchange = { name: string; method: string; path: string; form: Record<string, string> | null; status: number; body: unknown };
const tape: Exchange[] = [];
let name = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const form = method === "POST" ? Object.fromEntries(new URLSearchParams(String(init?.body))) : null;
  if (form) {
    delete form.access_token;
    const target = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const validating = form.execution_options === JSON.stringify(["validate_only"]);
    if (!validating && !(target === pausedAdId && form.status === "PAUSED")) throw new Error(`Recorder refuses a real write to ${target}.`);
  }
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  tape.push({ name, method, path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, form, status: response.status, body: JSON.parse(text.replace(/"access_token":"[^"]+"/g, "\"access_token\":\"page-token\"")) });
  console.log(name, method, response.status, decodeURIComponent(url.pathname + url.search).slice(0, 90), text.slice(0, 120));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const meta = new MetaClient({ adAccountId, pageId, accessToken: token });
  name = "validate-pause-live-ad";
  console.log(await meta.setAdStatus(campaignId, liveAdId, "PAUSED", { validateOnly: true }));
  name = "pause-paused-ad";
  console.log(await meta.setAdStatus(campaignId, pausedAdId, "PAUSED"));
  const scrubber = metaScrubber();
  const recorded = { recordedAt: new Date().toISOString(), campaignId, liveAdId, pausedAdId, creds: { adAccountId, pageId }, tape };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/ad-pause.json"), `${JSON.stringify(JSON.parse(scrubber.scrub(JSON.stringify(recorded))), null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
