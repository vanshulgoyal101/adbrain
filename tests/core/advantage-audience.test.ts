import { describe, expect, it } from "vitest";
import recorded from "./fixtures/meta/advantage-audience-validate.json";
import { adSetTargeting } from "@/lib/meta/client";

// #334: Meta's validate_only answers for Leads ad sets on the Solaride account (Oct 24),
// recorded by scripts/record-meta-advantage-audience.ts under an empty PAUSED campaign
// that was deleted afterwards. Docs: https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/targeting-expansion/advantage-audience

type Exchange = { name: string; form?: { targeting?: string }; status: number; body: { success?: boolean; error?: { error_subcode?: number } } };
const tape = recorded.tape as unknown as Exchange[];
const exchange = (name: string) => tape.find((entry) => entry.name === `adset-${name}`)!;
const sentTargeting = (name: string) => JSON.parse(exchange(name).form!.targeting!);
const tricity = { cities: [{ key: "1021145" }, { key: "2676092" }, { key: "1035473" }] };

describe("core: Advantage+ audience targeting against Meta's recorded validate_only answers (#334)", () => {
  it("Meta refuses a hard age_max below 65 or a hard age_min above 25 with Advantage+ on", () => {
    expect(exchange("on-age-25-55")).toMatchObject({ status: 400, body: { error: { error_subcode: 1870189 } } });
    expect(exchange("on-min-30")).toMatchObject({ status: 400, body: { error: { error_subcode: 1870188 } } });
  });

  it.each([
    ["the Solaride run's 25–55", 25, 55, "on-age-range-suggestion"],
    ["an owner minimum above 25", 30, 55, "on-age-range-30-55"],
    ["the older half of an age split", 41, 55, "on-age-range-41-55-split"],
    ["the full range (no suggestion)", 25, 65, "on-age-25-65"],
  ])("sends exactly what Meta accepted for %s", (_label, ageMin, ageMax, name) => {
    expect(exchange(name)).toMatchObject({ status: 200, body: { success: true } });
    expect(adSetTargeting({ location: tricity, ageMin, ageMax })).toEqual(sentTargeting(name));
  });

  it("keeps the area and exclusions hard, and gender and interests as Meta-accepted suggestions", () => {
    const interests = sentTargeting("on-gender-interest").flexible_spec[0].interests;
    expect(adSetTargeting({ location: tricity, ageMin: 25, ageMax: 65, gender: "men", interests })).toEqual(sentTargeting("on-gender-interest"));
    expect(adSetTargeting({ location: tricity, excludedLocation: { cities: [{ key: "1035473" }] }, ageMin: 25, ageMax: 65 }))
      .toEqual(sentTargeting("on-excluded-geo"));
    for (const name of ["on-gender-interest", "on-excluded-geo"]) expect(exchange(name).status).toBe(200);
  });

  it("never produces a combination Meta rejects, for any age range the plan allows", () => {
    for (let min = 18; min <= 65; min++) for (let max = min; max <= 65; max++) {
      const targeting = adSetTargeting({ location: tricity, ageMin: min, ageMax: max });
      expect(targeting.age_min).toBeLessThanOrEqual(25);
      expect(targeting.age_max).toBe(65);
      expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 });
      if (min > 25 || max < 65) expect(targeting.age_range).toEqual([min, max]);
    }
  });
});
