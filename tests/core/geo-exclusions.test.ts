import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient } from "@/lib/meta/client";
import {
  EXCLUDABLE_CITIES, INDIA_REGION_KEYS, SERVICE_BUFFER_KM, TargetingExclusionsMissingError,
  lacksAreaExclusions, mergeExclusions, serviceAreaExclusions,
} from "@/lib/meta/service-area";
import geoTape from "./fixtures/meta/geo-exclusions.json";
import launchValidate from "./fixtures/meta/launch-validate.json";

// geo-exclusions.json: read-only Targeting Search and location meta from Meta (scripts/record-meta-geo-exclusions.ts).
// launch-validate.json: Meta's validate_only answers for today's launch, now with the exclusions (#741).
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = [...(geoTape as Exchange[]), { method: "GET", ...launchValidate.geoMeta } as Exchange];
const regionsSearch = tape[0].body as { data: { key: string; name: string }[] };
const TRICITY = ["1021145", "1035473", "2676092"]; // Chandigarh, Mohali, Panchkula
const KEPT = ["1726", "1742", "1730"]; // Chandigarh UT, Punjab, Haryana

function replay() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const exchange = tape.find((entry) => entry.path === url.pathname.replace("/v21.0/", "") + url.search);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${url.pathname}${url.search}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("core: every Indian ad set excludes what's outside the service area (#741)", () => {
  it("knows exactly Meta's 36 India state/UT keys, matched by key", () => {
    expect(regionsSearch.data.map((region) => region.key).sort()).toEqual([...INDIA_REGION_KEYS].sort());
  });

  it("excludes the 33 other states and the distant Punjab/Haryana cities for Tricity, with no overlap", async () => {
    replay();
    const exclusions = await new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" })
      .serviceAreaExclusionsFor({ cities: TRICITY.map((key) => ({ key })) });
    const regions = exclusions!.regions!.map((region) => region.key);
    expect(regions).toHaveLength(33);
    expect(regions.filter((key) => KEPT.includes(key))).toEqual([]);
    const cities = exclusions!.cities!.map((city) => city.key);
    // Ludhiana, Amritsar, Ambala, Gurugram are out; nothing included is excluded.
    expect(cities).toEqual(expect.arrayContaining(["1033379", "1016294", "1016128", "1026297"]));
    expect(cities.filter((key) => TRICITY.includes(key))).toEqual([]);
    // Every excluded city is in a kept state and at least the buffer away (Meta caps excluded cities well above this).
    for (const key of cities) expect(KEPT).toContain(EXCLUDABLE_CITIES.find((city) => city.key === key)!.region);
    expect(cities.length).toBeLessThanOrEqual(250);
  });

  it("sends Meta exactly the exclusions it accepted on create, interests included (validate_only)", async () => {
    replay();
    const expected = await new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" })
      .serviceAreaExclusionsFor(launchValidate.inputs.location);
    for (const adSet of launchValidate.tape.filter((exchange) => exchange.kind === "adsets")) {
      expect(adSet).toMatchObject({ status: 200, body: { success: true } });
      const targeting = JSON.parse(adSet.form.targeting!);
      expect(targeting.excluded_geo_locations).toEqual(expected);
      expect(targeting.flexible_spec).toEqual([{ interests: launchValidate.inputs.interests }]);
      expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 });
    }
  });

  it("applies only to Indian areas: a US city (recorded) or a country-wide area gets none", async () => {
    replay();
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
    expect(await meta.serviceAreaExclusionsFor({ cities: [{ key: "2525495" }] })).toBeNull(); // Austin
    expect(await meta.serviceAreaExclusionsFor({ countries: ["IN"] })).toBeNull();
  });

  it("refuses rather than launching unprotected when Meta can't describe the area", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Service temporarily unavailable", code: 2 } }, { status: 503 }));
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
    await expect(meta.serviceAreaExclusionsFor({ cities: [{ key: "1021145" }] })).rejects.toBeInstanceOf(TargetingExclusionsMissingError);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: { cities: { "1021145": { key: "1021145", country_code: "IN" } } } }));
    await expect(meta.serviceAreaExclusionsFor({ cities: [{ key: "1021145" }] })).rejects.toMatchObject({ code: "TARGETING_EXCLUSIONS_MISSING" });
  });

  it("a launch whose exclusions can't be set is refused before anything is created on Meta", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Service temporarily unavailable", code: 2 } }, { status: 503 }));
    await expect(new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" }).createLeadCampaign({
      name: "No exclusions", dailyBudgetRupees: 300, leadFormId: "form-1", link: "https://solaride.in", creatives: [],
      location: { cities: TRICITY.map((key) => ({ key })) }, ageMin: 25, ageMax: 55,
    })).rejects.toMatchObject({ code: "TARGETING_EXCLUSIONS_MISSING" });
    expect(fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "POST")).toEqual([]);
  });

  it("measures the radius: a wider service area keeps nearer cities, an unknown city falls back to states only", () => {
    const tricity = TRICITY.map((key, index) => ({ key, type: "city" as const, regionKey: KEPT[index], countryCode: "IN" }));
    const near = serviceAreaExclusions(tricity)!.cities!.map((city) => city.key);
    const wide = serviceAreaExclusions(tricity.map((place) => ({ ...place, radiusKm: 60 })))!.cities!.map((city) => city.key);
    expect(near).toContain("1038870"); // Patiala, ~57 km
    expect(wide).not.toContain("1038870");
    expect(SERVICE_BUFFER_KM).toBe(30);
    const unknown = serviceAreaExclusions([...tricity, { key: "9999999", type: "city", regionKey: "1742", countryCode: "IN" }])!;
    expect(unknown.cities).toBeUndefined();
    expect(unknown.regions).toHaveLength(33);
  });

  it("#804: a state included as a whole keeps all its cities; other kept states still lose their distant ones", () => {
    const punjab = { key: "1742", type: "region" as const, regionKey: "1742", countryCode: "IN" };
    const chandigarh = { key: "1021145", type: "city" as const, regionKey: "1726", countryCode: "IN" };
    const panchkula = { key: "2676092", type: "city" as const, regionKey: "1730", countryCode: "IN" };
    const inPunjab = (key: string) => EXCLUDABLE_CITIES.find((city) => city.key === key)?.region === "1742";
    expect(serviceAreaExclusions([punjab])!.cities).toBeUndefined();
    const withCity = serviceAreaExclusions([chandigarh, punjab, panchkula])!;
    expect(withCity.regions!.map((region) => region.key)).not.toContain("1742");
    expect(withCity.cities!.filter((city) => inPunjab(city.key))).toEqual([]);
    expect(withCity.cities!.map((city) => city.key)).toEqual(expect.arrayContaining(["1026297", "1027034"])); // Gurugram, Hisar
    const tricity = TRICITY.map((key, index) => ({ key, type: "city" as const, regionKey: KEPT[index], countryCode: "IN" }));
    expect(serviceAreaExclusions(tricity)!.cities).toHaveLength(42);
  });

  it("keeps the owner's own exclusions and flags an Indian tree built before the rule", () => {
    expect(mergeExclusions({ cities: [{ key: "1033379", radius: 10, distance_unit: "kilometer" }] }, { regions: [{ key: "1731" }], cities: [{ key: "1033379" }] }))
      .toEqual({ regions: [{ key: "1731" }], cities: [{ key: "1033379", radius: 10, distance_unit: "kilometer" }] });
    const tricity = { geo_locations: { cities: [{ key: "1021145", country: "IN" }] } };
    expect(lacksAreaExclusions(tricity)).toBe(true);
    expect(lacksAreaExclusions({ ...tricity, excluded_geo_locations: { regions: [{ key: "1731" }] } })).toBe(false);
    expect(lacksAreaExclusions({ geo_locations: { cities: [{ key: "2525495", country: "US" }] } })).toBe(false);
    expect(lacksAreaExclusions({ geo_locations: { countries: ["IN"] } })).toBe(false);
  });
});
