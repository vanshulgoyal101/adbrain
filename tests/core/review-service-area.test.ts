import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient } from "@/lib/meta/client";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { INDIA_REGION_NAMES, INDIA_REGION_KEYS } from "@/lib/meta/service-area";
import geoTape from "./fixtures/meta/geo-exclusions.json";

// #741 item 4: Review says in plain words where the ads show and where they don't, from the same
// exclusions launch applies. geo-exclusions.json: Meta's recorded region search and Tricity location meta.
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = geoTape as Exchange[];
const TRICITY = ["1021145", "1035473", "2676092"];

function replay() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const exchange = tape.find((entry) => entry.path === url.pathname.replace("/v26.0/", "") + url.search);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${url.pathname}${url.search}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
}
afterEach(() => vi.restoreAllMocks());

const businessId = "ea6ea561-0000-4000-8000-000000000001";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
function review(geo: Partial<PreflightInput["geo"]>) {
  return runPreflight({
    draft: { businessId, name: "Solaride | Tricity", goal: "Free site survey", mode: "manual", destination: "whatsapp", creativeIds: [creativeId], dailyBudgetRupees: 280, leadFormId: null, abTest: false,
      targeting: { location: { mode: "ai", cityScope: "radius", radiusKm: 25, includedNames: ["Chandigarh", "Mohali", "Panchkula"] }, age: { mode: "manual", min: 30, max: 65 } , audience: { interestNames: [], rationale: "Homeowners." } } },
    draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 1,
    connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_1", accountName: "Solaride 101", pageId: "p", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/a.png", headline: "Free site survey" }],
    form: null, whatsappNumber: "+917009764842",
    geo: { resolvedAreaLabel: "Chandigarh, Mohali, Panchkula", unresolvedNames: [], explicitlyNationwide: false, ...geo },
    hash: () => "a".repeat(64),
  });
}

describe("core: Review shows where the ads show and where they don't (#741)", () => {
  it("names every India state/UT key Meta returned", () => {
    expect(Object.keys(INDIA_REGION_NAMES).sort()).toEqual([...INDIA_REGION_KEYS].sort());
    expect(INDIA_REGION_NAMES["1742"]).toBe("Punjab");
  });

  it("Tricity: the distant Punjab and Haryana cities by name, and the other 33 states and UTs", async () => {
    replay();
    const areaExclusions = await new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "t" })
      .serviceAreaExclusionsFor({ cities: TRICITY.map((key) => ({ key })) });
    const { serviceArea } = review({ areaExclusions });
    expect(serviceArea!.excludedStateCount).toBe(33);
    expect(serviceArea!.excludedCities).toContain("Ludhiana");
    expect(serviceArea!.keptStates).toEqual(expect.arrayContaining(["Punjab", "Haryana"]));
  });

  it("says nothing when no exclusions apply (outside India or nationwide)", () => {
    expect(review({ areaExclusions: null }).serviceArea).toBeUndefined();
  });
});
