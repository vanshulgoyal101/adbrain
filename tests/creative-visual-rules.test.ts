import { describe, expect, it } from "vitest";
import { emptyScene } from "@/lib/creative/visual-rules";

describe("emptyScene (#760)", () => {
  it("catches the production empty-room and bare-roof directions", () => {
    expect(emptyScene("A quiet, uncluttered reception area of a clinic. In the lower third, a single comfortable armchair sits in soft focus.")).toBe("reception area");
    expect(emptyScene("Wide view of a factory's flat roof, with a clean, unobstructed expanse of bare roof as the main subject.")).toBe("bare");
  });

  it("allows a scene with people, a team at work or the product, and ignores space kept clear for copy", () => {
    expect(emptyScene("A chiropractor greets a patient in a bright waiting room.")).toBeNull();
    expect(emptyScene("Solar panels fill the lower two-thirds. Above them the sky stays open and empty for the copy.")).toBeNull();
    expect(emptyScene("A modern rooftop with a neat array of dark panels. No people, no vehicles.")).toBeNull();
    expect(emptyScene("An empty waiting room with an armchair. No people are present.")).toBe("empty");
  });
});
