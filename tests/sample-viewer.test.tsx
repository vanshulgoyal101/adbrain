// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SampleViewer } from "@/components/sample-viewer";

const original = "https://x.supabase.co/storage/v1/object/public/creatives/b1/c1/originals-v1/ad-1.png";

// #1502: on mobile data the full picture paints top-down; the thumbnail step 2 already loaded shows underneath meanwhile.
describe("SampleViewer", () => {
  it("shows the full picture over its already-loaded thumbnail", () => {
    render(<SampleViewer ads={[{ id: "a", headline: "Free 3D design", image_url: original }]} onClose={vi.fn()} />);
    const img = screen.getByRole("img", { name: "Free 3D design" });
    expect(img).toHaveAttribute("src", original);
    expect(img.style.backgroundImage).toBe('url("https://x.supabase.co/storage/v1/object/public/creatives/b1/c1/thumbnails-v1/ad-1.webp")');
  });
});
