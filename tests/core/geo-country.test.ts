import { afterEach, describe, expect, it, vi } from "vitest";
import pilotTape from "./fixtures/meta/geo-pilot.json";
import tricityTape from "./fixtures/meta/geo-tricity.json";

// geo-pilot.json: real Graph place searches recorded read-only on 2026-10-28 (scripts/record-meta-geo-pilot.ts).
// geo-tricity.json: the Chandigarh/Mohali/Panchkula searches (#271).
import { resolveDraftTargeting } from "@/lib/campaign/draft-targeting";
import type { DraftInput } from "@/lib/campaign/connect-contracts";
import { MetaClient, pickBestGeoMatch, type GeoSearchResult } from "@/lib/meta/client";

type Exchange = { method: string; path: string; status: number; body: { data: GeoSearchResult[] } };
const tape = [...pilotTape, ...tricityTape] as Exchange[];
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const recorded = (q: string) => tape.find((entry) => new URLSearchParams(entry.path.split("?")[1]).get("q") === q)!.body.data;

function replay() {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${url.pathname.replace("/v26.0/", "")}${url.search}`;
    sent.push(new URLSearchParams(url.search).get("q") ?? call);
    const exchange = tape.find((entry) => entry.path === call);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${call}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return sent;
}

const draft = (includedNames: string[]): DraftInput => ({
  businessId: "business", name: "Solar", goal: "Local leads", mode: "guided", creativeIds: [], leadFormId: null,
  dailyBudgetRupees: 500, abTest: false, targeting: { location: { mode: "ai", cityScope: "city_only", includedNames } },
});

afterEach(() => vi.restoreAllMocks());

describe("core: an Indian business never targets a namesake abroad (#1555)", () => {
  it("Meta's only 'Tricity' is in Oregon, so it isn't a match for an Indian business", () => {
    const results = recorded("Tricity");
    expect(results.map((place) => place.country_code)).toEqual(["US"]);
    expect(pickBestGeoMatch(results, "Tricity", "IN")).toBeNull();
  });

  it("Prepare reads 'Tricity' as Chandigarh, Mohali and Panchkula, and never searches Oregon", async () => {
    const sent = replay();
    const meta = new MetaClient(creds);
    const result = await resolveDraftTargeting(draft(["Tricity"]), [], meta.resolveGeoTargeting.bind(meta));
    expect(result.location).toEqual({ cities: [{ key: "1021145" }, { key: "1035473" }, { key: "2676092" }] });
    expect(result.unresolvedNames).toEqual([]);
    expect(sent).not.toContain("Tricity");
  });

  it("a foreign-only match comes back unresolved, so Go live asks instead of spending abroad", async () => {
    const meta = new MetaClient(creds);
    vi.spyOn(meta, "searchGeoLocations").mockResolvedValue(recorded("Tricity"));
    const geo = await meta.resolveGeoTargeting(["Tri City Oregon"], { preferCountry: "IN", cityScope: "city_only" });
    expect(geo).toEqual({ targeting: {}, matched: [], unresolved: ["Tri City Oregon"] });
  });

  it("Prepare resolves in the business's country by default", async () => {
    const resolve = vi.fn(async () => ({ targeting: {}, matched: [], unresolved: [] }));
    await resolveDraftTargeting(draft(["Chandigarh"]), [], resolve);
    expect(resolve).toHaveBeenCalledWith(["Chandigarh"], expect.objectContaining({ preferCountry: "IN" }));
  });
});
