/**
 * Records the real Graph ad account funding read for the test:core operator-funding
 * fixture (#245), and with --live-runs the funding read plus the account's running capped runs
 * (#1058) at the same moment. Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-funding-fixtures.ts
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID; tokens are stripped.
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";
import { metaScrubber } from "./lib/scrub-meta";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Funding recorder is read-only.");
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
  const liveRuns = process.argv.includes("--live-runs");
  console.log(JSON.stringify(await meta.readAccountFunding()));
  if (liveRuns) console.log(JSON.stringify(await meta.readLiveCappedRuns()));
  if (JSON.stringify(tape).includes("access_token")) throw new Error("Token leaked into the tape.");
  const name = liveRuns ? "account-funding-live-runs" : "account-funding";
  // #1094 (QA): the live-runs tape is scrubbed (ids become stable fakes, cursors dropped); it carries its fake
  // ad account so tests can replay it, or map it onto the account of another tape.
  const scrubber = metaScrubber();
  const fixture = liveRuns ? JSON.parse(scrubber.scrub(JSON.stringify({ adAccountId: process.env.META_AD_ACCOUNT_ID, tape }))) : tape;
  writeFileSync(join(process.cwd(), `tests/core/fixtures/meta/${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${name}: ${tape.length} exchanges`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
