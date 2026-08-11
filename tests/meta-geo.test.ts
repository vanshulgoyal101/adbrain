import { describe, expect, it } from "vitest";
import {
  buildGeoLocations,
  pickBestGeoMatch,
  type GeoSearchResult,
} from "@/lib/meta/client";

const jaipurCity: GeoSearchResult = {
  key: "1006351",
  name: "Jaipur",
  type: "city",
  country_code: "IN",
  region: "Rajasthan",
};
const jaipurRegion: GeoSearchResult = {
  key: "3847",
  name: "Jaipur",
  type: "region",
  country_code: "IN",
};
const jaipurUs: GeoSearchResult = {
  key: "999",
  name: "Jaipur",
  type: "city",
  country_code: "US",
};

describe("pickBestGeoMatch", () => {
  it("returns null for no matches", () => {
    expect(pickBestGeoMatch([], "Jaipur")).toBeNull();
  });

  it("prefers a city over a same-name region", () => {
    const best = pickBestGeoMatch([jaipurRegion, jaipurCity], "Jaipur");
    expect(best?.type).toBe("city");
    expect(best?.key).toBe("1006351");
  });

  it("prefers the result in the preferred country", () => {
    const best = pickBestGeoMatch([jaipurUs, jaipurCity], "Jaipur", "IN");
    expect(best?.country_code).toBe("IN");
  });

  it("trusts Meta's relevance order for same-name cities (even localized names)", () => {
    // Meta returns the canonical Jaipur (Rajasthan) first, sometimes in Hindi.
    const canonical: GeoSearchResult = {
      key: "1027633",
      name: "जयपुर",
      type: "city",
      country_code: "IN",
      region: "Rajasthan",
    };
    const namesake: GeoSearchResult = {
      key: "1027632",
      name: "Jaipur, India",
      type: "city",
      country_code: "IN",
      region: "Maharashtra",
    };
    expect(pickBestGeoMatch([canonical, namesake], "Jaipur")?.key).toBe(
      "1027633",
    );
  });
});

describe("buildGeoLocations", () => {
  it("falls back to countries when nothing resolved", () => {
    expect(buildGeoLocations(undefined, ["IN"])).toEqual({ countries: ["IN"] });
    expect(buildGeoLocations({}, ["IN"])).toEqual({ countries: ["IN"] });
  });

  it("emits cities with radius when present (no fallback country)", () => {
    const geo = buildGeoLocations(
      { cities: [{ key: "1006351", radius: 25, distance_unit: "kilometer" }] },
      ["IN"],
    );
    expect(geo).toEqual({
      cities: [{ key: "1006351", radius: 25, distance_unit: "kilometer" }],
    });
    expect(geo.countries).toBeUndefined();
  });

  it("combines cities, regions, and explicit countries", () => {
    const geo = buildGeoLocations(
      {
        cities: [{ key: "1", radius: 30, distance_unit: "kilometer" }],
        regions: [{ key: "3847" }],
        countries: ["IN"],
      },
      ["IN"],
    );
    expect(geo).toEqual({
      cities: [{ key: "1", radius: 30, distance_unit: "kilometer" }],
      regions: [{ key: "3847" }],
      countries: ["IN"],
    });
  });
});
