/**
 * #749: records Meta's real answer to the read that finds an owner's video by its upload name, for test:core
 * (tests/core/meta-media-contract.test.ts). Read-only: one `GET act_<id>/advideos` page, and the same read with
 * `filtering` on title, which Meta refuses (100), so the lookup scans newest-first instead. Nothing is written.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-advideos-list.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AD_VIDEO_LIST_FIELDS } from "@/lib/meta/media";
import { GRAPH } from "@/lib/meta/graph-version";
import { metaScrubber } from "./lib/scrub-meta";

const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;

type Exchange = { name: string; method: "GET"; path: string; status: number; body: unknown };

async function read(name: string, path: string): Promise<Exchange> {
  const response = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as Record<string, unknown>;
  // Paging links carry the access token; the client follows cursors, never these URLs. Trace ids are Meta's, not ours.
  const paging = body.paging as Record<string, unknown> | undefined;
  if (paging) { delete paging.next; delete paging.previous; }
  const error = body.error as Record<string, unknown> | undefined;
  if (error) delete error.fbtrace_id;
  console.log(name, response.status, JSON.stringify(body).slice(0, 160));
  return { name, method: "GET", path, status: response.status, body };
}

async function main() {
  const tape = [
    await read("list-videos", `${adAccountId}/advideos?fields=${encodeURIComponent(AD_VIDEO_LIST_FIELDS)}&limit=50`),
    await read("filter-by-title", `${adAccountId}/advideos?fields=id,title&filtering=${encodeURIComponent(JSON.stringify([{ field: "title", operator: "EQUAL", value: "owner-clip.mp4" }]))}`),
  ];
  const { scrub } = metaScrubber();
  const out = JSON.parse(scrub(JSON.stringify({ recordedAt: new Date().toISOString(), adAccountId, tape })));
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/advideos-list.json"), `${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
