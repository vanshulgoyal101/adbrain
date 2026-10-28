/**
 * #1055: records Meta's real `source_ad_id` answers (`MetaClient.adSources`) for a capped run's copy
 * and its reviewed original, for test:core. GETs only; the tape is scrubbed (scripts/lib/scrub-meta.ts).
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-ad-sources.ts <cappedCopyAdId> <originalAdId>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";
import { metaScrubber } from "./lib/scrub-meta";

const [copyAdId, originalAdId] = process.argv.slice(2);
if (!originalAdId) throw new Error("Pass a capped copy's ad id and its original's.");
const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
const tape: { path: string; status: number; body: unknown }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if ((init?.method ?? "GET") !== "GET") throw new Error("Recorder refuses anything but GET.");
  const url = new URL(String(input));
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  tape.push({ path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, status: response.status, body: JSON.parse(text) });
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const sources = await new MetaClient({ adAccountId, pageId, accessToken: token }).adSources([copyAdId, originalAdId]);
  console.log(sources);
  const recorded = { recordedAt: new Date().toISOString(), copyAdId, originalAdId, sources, creds: { adAccountId, pageId }, tape };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/ad-sources.json"), `${JSON.stringify(JSON.parse(metaScrubber().scrub(JSON.stringify(recorded))), null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
