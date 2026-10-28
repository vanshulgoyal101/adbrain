import { describe, expect, it } from "vitest";
import { leaveBehindBlock, segmentBySlug, segmentForCategory } from "@/lib/segments";

describe("prospect pack leave-behind (#1582)", () => {
  it.each([
    ["rooftop solar installer", "solar"], ["Solar energy", "solar"],
    ["IELTS coaching", "ielts"], ["study abroad consultant", "ielts"], ["PTE and IELTS institute", "ielts"],
    ["Interior designer", "interiors"], ["modular kitchens", "interiors"], ["Home interiors & wardrobes", "interiors"],
  ])("maps the Brand category %j to /for/%s", (category, slug) => {
    expect(segmentForCategory(category)?.slug).toBe(slug);
  });

  it.each(["dental clinic", "", null, undefined, "bakery"])("maps %j to no segment", (category) => {
    expect(segmentForCategory(category)).toBeNull();
  });

  it("uses the CPO's message: business name filled, owner name left for the rep (#1582)", () => {
    const solar = segmentBySlug("solar")!;
    const lines = leaveBehindBlock(solar, { businessName: "SunPeak Solar" }).split("\n");
    expect(lines).toEqual(expect.arrayContaining([
      "After the visit, send the owner this on WhatsApp:",
      "Hi {owner name}, thanks for your time today. Here are the 3 sample ads I made for SunPeak Solar.",
      solar.headline, solar.hinglish,
      "Your first campaign is set up free. You pay Meta directly, only for the ads you approve.",
      "See how it works: https://adbrain.vanshul.com/for/solar",
    ]));
    expect(leaveBehindBlock(solar)).toContain("made for {business name}.");
  });

  it("ends with the segment's WhatsApp line and its landing link, and never a margin or a promise", () => {
    const block = leaveBehindBlock(segmentBySlug("solar")!);
    expect(block).toContain("https://adbrain.vanshul.com/for/solar");
    expect(block.trimEnd().endsWith("https://adbrain.vanshul.com/for/solar")).toBe(true);
    expect(block).toMatch(/WhatsApp/);
    expect(block).not.toMatch(/%|margin|service fee|guarantee/i);
  });
});
