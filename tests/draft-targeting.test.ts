import { describe, expect, it, vi } from "vitest";
import { resolveDraftTargeting } from "@/lib/campaign/draft-targeting";
import type { DraftInput } from "@/lib/campaign/connect-contracts";
import { MetaClient } from "@/lib/meta/client";

const input: DraftInput = {
  businessId: "business", name: "Local campaign", goal: "Local leads", mode: "guided",
  creativeIds: [], leadFormId: null, dailyBudgetRupees: 500, abTest: false,
  targeting: { location: { mode: "ai", includedNames: ["Jaipur"], excludedNames: ["Ajmer"] } },
};

describe("saved draft targeting", () => {
  it("omits radius for selected cities and exclusions even when an old radius is saved", async () => {
    const resolve = vi.fn();
    const result = await resolveDraftTargeting({ ...input, targeting: { location: {
      mode: "manual", cityScope: "city_only", radiusKm: 25,
      included: [{ key: "123", name: "Jaipur", type: "city", radiusKm: 40 }],
      excluded: [{ key: "456", name: "Ajmer", type: "city" }],
    } } }, [], resolve);
    expect(result.location).toEqual({ cities: [{ key: "123" }] });
    expect(result.excludedLocation).toEqual({ cities: [{ key: "456" }] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("omits radius when resolving AI city names through the Meta adapter", async () => {
    const meta = new MetaClient({ adAccountId: "act_1", pageId: "1", accessToken: "test" });
    vi.spyOn(meta, "searchGeoLocations").mockImplementation(async (name) => [{ key: name, name, type: "city" }]);
    const result = await resolveDraftTargeting({ ...input, targeting: { location: {
      ...input.targeting.location, cityScope: "city_only",
    } } }, [], meta.resolveGeoTargeting.bind(meta));
    expect(result.location).toEqual({ cities: [{ key: "Jaipur" }] });
    expect(result.excludedLocation).toEqual({ cities: [{ key: "Ajmer" }] });
  });

  it("resolves the requested areas rather than the business default, including exclusions", async () => {
    const resolve = vi.fn().mockImplementation(async (names: string[]) => ({
      targeting: { cities: [{ key: names[0] }] },
      matched: [{ key: names[0], name: names[0], label: names[0], type: "city" }], unresolved: [],
    }));
    const result = await resolveDraftTargeting(input, ["Delhi"], resolve);
    expect(resolve).toHaveBeenCalledWith(["Jaipur"], expect.any(Object));
    expect(resolve).toHaveBeenCalledWith(["Ajmer"], expect.any(Object));
    expect(result.location).toEqual({ cities: [{ key: "Jaipur" }] });
    expect(result.excludedLocation).toEqual({ cities: [{ key: "Ajmer" }] });
    expect(result.unresolvedNames).toEqual([]);
  });

  it("retains unresolved exclusions as blockers", async () => {
    const resolve = vi.fn().mockImplementation(async (names: string[]) => ({
      targeting: { cities: [{ key: "Jaipur" }] },
      matched: names[0] === "Jaipur" ? [{ key: "Jaipur", name: "Jaipur", label: "Jaipur", type: "city" }] : [],
      unresolved: names[0] === "Ajmer" ? ["Ajmer"] : [],
    }));
    expect((await resolveDraftTargeting(input, ["Delhi"], resolve)).unresolvedNames).toEqual(["Ajmer"]);
  });

  it("does not call Meta for explicitly selected location keys", async () => {
    const resolve = vi.fn();
    const result = await resolveDraftTargeting({ ...input, targeting: { location: { mode: "manual", included: [{ key: "123", name: "Jaipur", type: "city" }] } } }, ["Delhi"], resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(result.location.cities?.[0].key).toBe("123");
    expect(result.resolvedAreaLabel).toBe("Jaipur");
  });
});