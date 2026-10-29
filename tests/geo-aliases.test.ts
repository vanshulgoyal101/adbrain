import { describe, expect, it } from "vitest";
import { expandPlaceAliases } from "@/lib/meta/geo-aliases";

describe("expandPlaceAliases (#1555, #1556)", () => {
  it("names the Tricity places Meta knows", () => {
    expect(expandPlaceAliases(["Tri-City"])).toEqual(["Chandigarh", "Mohali", "Panchkula"]);
    expect(expandPlaceAliases(["Derabassi", "dera-bassi"])).toEqual(["Dera Bassi"]);
    expect(expandPlaceAliases(["Zirakpur", "Mohali"])).toEqual(["Chandigarh", "Mohali", "Panchkula"]);
  });

  it("reads sectors and phases as their city, either way round", () => {
    expect(expandPlaceAliases(["Sector 34, Chandigarh", "Mohali Phase 3B2", "Panchkula Sec 20", "Phase 7 Mohali"])).toEqual(["Chandigarh", "Mohali", "Panchkula"]);
  });

  it("leaves a bare sector and everything else as typed", () => {
    expect(expandPlaceAliases(["Sector 17", "Jaipur", "Austin, Texas"])).toEqual(["Sector 17", "Jaipur", "Austin, Texas"]);
  });
});
