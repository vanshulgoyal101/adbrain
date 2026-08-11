import { describe, expect, it } from "vitest";
import {
  describeAudience,
  normalizeTargetingInput,
} from "@/lib/campaign/targeting";

describe("normalizeTargetingInput", () => {
  it("defaults to AI mode with sensible values when empty", () => {
    const t = normalizeTargetingInput(null);
    expect(t.locationMode).toBe("ai");
    expect(t.ageMode).toBe("ai");
    expect(t.included).toEqual([]);
    expect(t.excluded).toEqual([]);
    expect(t.radiusKm).toBe(25);
    expect(t.ageMin).toBeUndefined();
    expect(t.ageMax).toBeUndefined();
  });

  it("keeps valid manual picks and drops invalid ones", () => {
    const t = normalizeTargetingInput({
      location: {
        mode: "manual",
        included: [
          { key: "1", name: "Jaipur", type: "city" },
          { key: "", name: "bad", type: "city" }, // no key
          { key: "2", name: "Nowhere", type: "zip" }, // invalid type
        ],
      },
    });
    expect(t.locationMode).toBe("manual");
    expect(t.included.map((i) => i.name)).toEqual(["Jaipur"]);
  });

  it("dedupes places by type+key", () => {
    const t = normalizeTargetingInput({
      location: {
        mode: "manual",
        included: [
          { key: "1", name: "Jaipur", type: "city" },
          { key: "1", name: "Jaipur dup", type: "city" },
        ],
      },
    });
    expect(t.included).toHaveLength(1);
  });

  it("clamps per-city radius and the default radius", () => {
    const t = normalizeTargetingInput({
      location: {
        mode: "manual",
        radiusKm: 500,
        included: [{ key: "1", name: "Jaipur", type: "city", radiusKm: 1 }],
      },
    });
    expect(t.radiusKm).toBe(80); // clamped to max
    expect(t.included[0].radiusKm).toBe(5); // clamped to min
  });

  it("clamps manual ages and keeps max >= min", () => {
    const t = normalizeTargetingInput({
      age: { mode: "manual", min: 5, max: 3 },
    });
    expect(t.ageMode).toBe("manual");
    expect(t.ageMin).toBe(18);
    expect(t.ageMax).toBe(18);
  });

  it("omits ages entirely in AI mode", () => {
    const t = normalizeTargetingInput({ age: { mode: "ai", min: 30, max: 40 } });
    expect(t.ageMin).toBeUndefined();
    expect(t.ageMax).toBeUndefined();
  });
});

describe("describeAudience", () => {
  it("summarises area, exclusions and manual ages", () => {
    const s = describeAudience({
      areaLabel: "Jaipur",
      excluded: [{ key: "9", name: "Kota", type: "city" }],
      ageMode: "manual",
      ageMin: 30,
      ageMax: 55,
    });
    expect(s).toBe("People in Jaipur, excluding Kota, ages 30–55.");
  });

  it("defers ages to Advantage+ in AI mode", () => {
    const s = describeAudience({
      areaLabel: "India (nationwide)",
      excluded: [],
      ageMode: "ai",
    });
    expect(s).toBe(
      "People in India (nationwide), ages chosen by Meta Advantage+.",
    );
  });
});
