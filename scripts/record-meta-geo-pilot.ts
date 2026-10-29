/**
 * #1555, #1556: records, read-only, Meta's place search for the Tricity names owners type, exactly as
 * MetaClient.searchGeoLocations sends it (city/region/country, limit 10). 'Tricity' only matches
 * Tri-City, Oregon; Zirakpur, Derabassi, New Chandigarh, sectors and phases match nothing.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-geo-pilot.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const GRAPH = "https://graph.facebook.com/v26.0/";
const token = process.env.META_SYSTEM_USER_TOKEN;
if (!token) throw new Error("Needs META_SYSTEM_USER_TOKEN.");

const NAMES = ["Tricity", "Zirakpur", "Derabassi", "Dera Bassi", "New Chandigarh", "Aerocity Mohali", "Sector 34 Chandigarh", "Mohali Phase 7", "Kharar"];

type Exchange = { method: "GET"; path: string; status: number; body: unknown };
const tape: Exchange[] = [];

async function main() {
  for (const q of NAMES) {
    const path = `search?${new URLSearchParams({ type: "adgeolocation", q, location_types: JSON.stringify(["city", "region", "country"]), limit: "10" })}`;
    const response = await fetch(`${GRAPH}${path}&access_token=${token}`);
    const body = await response.json();
    // Paging links carry the token; never write it to the repository.
    tape.push({ method: "GET", path, status: response.status, body: JSON.parse(JSON.stringify(body).replace(/access_token=[^&"]+/g, "access_token=REDACTED")) });
    if (!response.ok) throw new Error(`search ${q} → ${response.status}`);
  }
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/geo-pilot.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`geo-pilot: ${tape.length} exchanges`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
