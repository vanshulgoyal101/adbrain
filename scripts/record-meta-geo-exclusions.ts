/**
 * #741: records, read-only, the Meta location facts the service-area exclusions use:
 * India's state/UT keys (Targeting Search, `locale=en_US`, matched by key because some names
 * come back in Hindi) and the location meta (region, country) of the Tricity cities.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-geo-exclusions.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const GRAPH = "https://graph.facebook.com/v26.0/";
const token = process.env.META_SYSTEM_USER_TOKEN;
if (!token) throw new Error("Needs META_SYSTEM_USER_TOKEN.");

type Exchange = { method: "GET"; path: string; status: number; body: unknown };
const tape: Exchange[] = [];

async function get(path: string) {
  const response = await fetch(`${GRAPH}${path}&access_token=${token}`);
  const body = await response.json();
  // Paging links carry the token; never write it to the repository.
  tape.push({ method: "GET", path, status: response.status, body: JSON.parse(JSON.stringify(body).replace(/access_token=[^&"]+/g, "access_token=REDACTED")) });
  if (!response.ok) throw new Error(`GET ${path.split("?")[0]} → ${response.status}`);
  return body;
}

const params = (values: Record<string, string>) => new URLSearchParams(values).toString();

async function main() {
  await get(`search?${params({ type: "adgeolocation", location_types: '["region"]', country_code: "IN", limit: "100", locale: "en_US" })}`);
  // The exact reads MetaClient.serviceAreaExclusionsFor sends (same parameter order), for the replayed launches.
  for (const cities of [["1021145", "1035473", "2676092"], ["2525495"]]) {
    await get(`search?${params({ type: "adgeolocationmeta", locale: "en_US", cities: JSON.stringify(cities) })}`);
  }
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/geo-exclusions.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`geo-exclusions: ${tape.length} exchanges`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
