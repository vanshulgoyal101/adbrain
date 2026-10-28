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

  it("ends with the segment's WhatsApp line and its landing link, and never a margin or a promise", () => {
    const block = leaveBehindBlock(segmentBySlug("solar")!);
    expect(block).toContain("https://adbrain.vanshul.com/for/solar");
    expect(block.trimEnd().endsWith("https://adbrain.vanshul.com/for/solar")).toBe(true);
    expect(block).toMatch(/WhatsApp/);
    expect(block).not.toMatch(/%|margin|service fee|guarantee/i);
  });
});
