/**
 * #1809: records, read-only, Meta's place search for the production smoke business's saved areas, exactly as
 * MetaClient.resolveGeoTargeting sends it, so a rule change that breaks the smoke's data fails CI (#1745).
 * Records both the current qualified names and #1745's bare ones (the test shows those fail).
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-geo-smoke.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "../src/lib/meta/client";
import smoke from "../tests/core/fixtures/smoke-business.json";

const token = process.env.META_SYSTEM_USER_TOKEN;
if (!token) throw new Error("Needs META_SYSTEM_USER_TOKEN.");

type Exchange = { method: "GET"; path: string; status: number; body: unknown };
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input, init);
  const url = new URL(String(input));
  for (const secret of ["access_token", "appsecret_proof"]) url.searchParams.delete(secret);
  const body = await response.clone().json().catch(() => null);
  // Paging links carry the token; never write it to the repository.
  tape.push({ method: "GET", path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, status: response.status,
    body: JSON.parse(JSON.stringify(body).replace(/access_token=[^&"]+/g, "access_token=REDACTED")) });
  return response;
};

async function main() {
  const meta = new MetaClient({ adAccountId: "act_0", pageId: "0", accessToken: token! });
  for (const names of [smoke.locations, smoke.before1745.locations]) await meta.resolveGeoTargeting(names, { preferCountry: smoke.country });
  const unique = [...new Map(tape.map((exchange) => [exchange.path, exchange])).values()];
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/geo-smoke.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), tape: unique }, null, 2)}\n`);
  console.log(`geo-smoke: ${unique.length} exchanges`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
