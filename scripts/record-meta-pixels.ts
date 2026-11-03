/**
 * #2712: records, read-only, Meta's real answers for the pixel read behind `TrackingStatus`, for test:core
 * (tests/core/meta-pixels.test.ts). It runs `MetaClient.trackingStatus` against the test ad account, which has one
 * pixel (`AdBrain test pixel (#2595)`, created once under CEO decision #2717) and, so far, only test events (Meta
 * keeps those out of `/stats`), plus Meta's refusal for a pixel this token can't read. Only GETs leave the process.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-pixels.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";
import { metaScrubber } from "./lib/scrub-meta";

const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const UNREADABLE_PIXEL = "1234567890123456";

type Exchange = { name: string; method: string; path: string; form: null; status: number; body: unknown };
const tape: Exchange[] = [];
let name = "";

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method !== "GET") throw new Error(`Recorder refuses ${method} ${url.pathname}.`);
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  url.searchParams.delete("appsecret_proof");
  tape.push({ name, method, path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, form: null, status: response.status, body: JSON.parse(text) });
  console.log(name, response.status, decodeURIComponent(url.pathname).slice(0, 60), text.slice(0, 200));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const now = new Date();
  const meta = new MetaClient({ adAccountId, pageId, accessToken: token });
  name = "tracking";
  const status = await meta.trackingStatus({ now });
  console.log(status);
  if (status.state !== "quiet") throw new Error(`Expected the test pixel to be quiet, got ${status.state}; review before re-recording.`);
  name = "stats-refused";
  const window = status.window!;
  await fetch(`https://graph.facebook.com/v26.0/${UNREADABLE_PIXEL}/stats?aggregation=event&start_time=${encodeURIComponent(window.since)}&end_time=${encodeURIComponent(window.until)}`,
    { headers: { Authorization: `Bearer ${token}` } });

  const scrubber = metaScrubber();
  const recorded = {
    note: "#2712: read-only recording from the test ad account. `noPixels` is the real `act_/adspixels` answer read at 2026-11-02T16:19Z, just before the pixel was created (#2717); `tracking` is the pixel list and its 7-day stats after Lead/Purchase test events (excluded from stats by Meta); `stats-refused` is Meta's answer for a pixel this token can't read.",
    recordedAt: now.toISOString(),
    creds: { adAccountId, pageId },
    unreadablePixel: UNREADABLE_PIXEL,
    noPixels: { data: [] },
    tape,
  };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/pixels.json"), `${JSON.stringify(JSON.parse(scrubber.scrub(JSON.stringify(recorded))), null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
