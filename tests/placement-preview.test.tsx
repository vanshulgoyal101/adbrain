// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlacementPreview, SAFE_ZONE, placementNote } from "@/components/placement-preview";
import { checkMetaSpecs } from "@/lib/media/meta-specs";

const wideVideo = checkMetaSpecs({ mime: "video/mp4", width: 1920, height: 1080, bytes: 5_000_000, durationSec: 20 });
const goodPhoto = checkMetaSpecs({ mime: "image/jpeg", width: 1080, height: 1350, bytes: 400_000 });

describe("PlacementPreview (#781)", () => {
  it("shows Feed first at 4:5, with no note for a fitting photo", () => {
    render(<PlacementPreview imageUrl="https://example.com/a.jpg" title="Ad" verdicts={goodPhoto} />);
    expect(screen.getByTestId("preview-feed").className).toContain("aspect-[4/5]");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Stories & Reels shows 9:16 with Meta's safe zones shaded", () => {
    render(<PlacementPreview imageUrl="https://example.com/a.jpg" title="Ad" verdicts={goodPhoto} />);
    fireEvent.click(screen.getByRole("tab", { name: "Stories & Reels" }));
    expect(screen.getByTestId("preview-tall").className).toContain("aspect-[9/16]");
    expect(screen.getByTestId("safe-top").style.height).toBe(`${SAFE_ZONE.top}%`);
    expect(screen.getByTestId("safe-bottom").style.height).toBe(`${SAFE_ZONE.bottom}%`);
    expect([SAFE_ZONE.top, SAFE_ZONE.bottom, SAFE_ZONE.side]).toEqual([14, 35, 6]);
  });

  it("a 16:9 video says in plain words it runs in Feed only", () => {
    render(<PlacementPreview imageUrl={null} title="Clip" verdicts={wideVideo} />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Stories & Reels" }));
    expect(screen.getByRole("status").textContent).toContain("Use it in Feed only");
  });

  it("the WhatsApp tab appears only with an opening, and shows greeting and message", () => {
    const { rerender } = render(<PlacementPreview imageUrl={null} title="Ad" verdicts={null} />);
    expect(screen.queryByRole("tab", { name: "WhatsApp" })).toBeNull();
    rerender(<PlacementPreview imageUrl={null} title="Ad" verdicts={null} whatsapp={{ greeting: "Hi! Ask us anything.", message: "I want a quote" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "WhatsApp" }));
    expect(screen.getByTestId("preview-whatsapp").textContent).toContain("I want a quote");
  });

  it("a tab shows one note, the blocking one before a warning", () => {
    const tiny = checkMetaSpecs({ mime: "image/jpeg", width: 100, height: 100, bytes: 1000 });
    expect(placementNote(tiny, "tall")).toContain("too small");
    expect(placementNote(goodPhoto, "tall")).toContain("Fit it to a tall picture");
    expect(placementNote(checkMetaSpecs({ mime: "image/jpeg", width: 1080, height: 1920, bytes: 400_000 }), "tall")).toBeNull();
    expect(placementNote(null, "feed")).toBeNull();
  });
});
