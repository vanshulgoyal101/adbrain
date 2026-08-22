import { describe, expect, it } from "vitest";
import { fieldList, fieldStr } from "@/lib/brand/fields";

describe("fieldStr", () => {
  it("trims and returns the value", () => {
    expect(fieldStr("  Acme  ")).toBe("Acme");
  });
  it("returns null for empty, whitespace, or non-string values", () => {
    expect(fieldStr("")).toBeNull();
    expect(fieldStr("   ")).toBeNull();
    expect(fieldStr(null)).toBeNull();
    expect(fieldStr(new File([], "x"))).toBeNull();
  });
});

describe("fieldList", () => {
  it("splits comma-or-newline fields and trims blanks", () => {
    expect(fieldList("Hindi, English,\nMarathi ,")).toEqual([
      "Hindi",
      "English",
      "Marathi",
    ]);
  });

  it("keeps commas as content for one-per-line fields", () => {
    // The real bug: a comma inside a USP must not create a second entry.
    expect(fieldList("Affordable, transparent pricing\n24x7 support", /\n/)).toEqual([
      "Affordable, transparent pricing",
      "24x7 support",
    ]);
  });

  it("drops empty lines and surrounding whitespace", () => {
    expect(fieldList("  A \n\n  B  \n", /\n/)).toEqual(["A", "B"]);
  });

  it("returns an empty array for non-string values", () => {
    expect(fieldList(null)).toEqual([]);
    expect(fieldList(new File([], "x"))).toEqual([]);
  });
});
