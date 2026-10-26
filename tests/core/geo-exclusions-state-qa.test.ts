import { describe, expect, it } from "vitest";
import { EXCLUDABLE_CITIES, serviceAreaExclusions } from "@/lib/meta/service-area";

// QA (#741 / PR #802): the CTO's rule is "never exclude a place that overlaps the included area".
// When the owner includes a whole state (Meta region key) plus a city, the city exclusions are
// still computed from the city centres alone, so the big cities INSIDE the included state are
// excluded: a "Punjab + Chandigarh" campaign silently drops Ludhiana, Amritsar, Jalandhar and the rest.
// Keys as recorded in tests/core/fixtures/meta/geo-exclusions.json: Punjab 1742, Chandigarh UT 1726.
const PUNJAB = "1742";

describe("out-of-area exclusions never cut into a state the owner included (QA, #741)", () => {
  it("excludes no city inside an included state", () => {
    const exclusions = serviceAreaExclusions([
      { key: PUNJAB, type: "region", regionKey: PUNJAB, countryCode: "IN" },
      { key: "1021145", type: "city", regionKey: "1726", countryCode: "IN" },
    ]);
    const punjabCities = new Set(EXCLUDABLE_CITIES.filter((city) => city.region === PUNJAB).map((city) => city.key));
    expect(exclusions?.regions?.map((region) => region.key)).not.toContain(PUNJAB);
    expect((exclusions?.cities ?? []).filter((city) => punjabCities.has(city.key))).toEqual([]);
  });

  it("still excludes the distant cities of a state that is kept only because an included city lies in it", () => {
    const exclusions = serviceAreaExclusions([
      { key: "1021145", type: "city", regionKey: "1726", countryCode: "IN" },
      { key: "1035473", type: "city", regionKey: PUNJAB, countryCode: "IN" },
    ]);
    expect((exclusions?.cities ?? []).map((city) => city.key)).toContain("1033379");
  });
});
