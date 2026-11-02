// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaLibrary } from "@/components/media-library";
import type { MediaView } from "@/lib/media/store";
import type { BrandAsset, CreativePreview } from "@/lib/types";

const photo = (over: Partial<MediaView> = {}): MediaView => ({
  id: "m1", name: "Finished kitchen", tags: [], width: 1080, height: 1350, bytes: 400_000,
  fit: { level: "ready", ratio: "4:5", message: "Ready for Feed, Stories and Reels" },
  url: "https://example.com/m1.jpg", createdAt: "2026-10-29T10:00:00Z", ...over,
});
const ad = { id: "c1", image_url: "https://example.com/a.jpg", headline: "Slash your power bill", angle: "savings", status: "approved" } as unknown as CreativePreview;
const biz = { id: "b1", vertical: "Interior design" };
const logo = { id: "a1", business_id: "b1", url: "https://example.com/logo.png", type: "logo", notes: null } as unknown as BrandAsset;

describe("<MediaLibrary> (#778 slice 3a)", () => {
  it("shows the CPO's empty state with one action when the owner has no photos yet", () => {
    render(<MediaLibrary business={biz} media={[]} creatives={[ad]} brandAssets={[]} />);
    expect(screen.getByText("No photos or videos yet. Add your own work: finished jobs, your shop, your team.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add photos & videos" }));
    expect(screen.getByRole("dialog", { name: "Add photos & videos" })).toBeInTheDocument();
  });

  it("lists own photos with their fit line, and the ads AdBrain made, under All", () => {
    render(<MediaLibrary business={biz} media={[photo()]} creatives={[ad]} brandAssets={[logo]} />);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: "Finished kitchen" })).toHaveAttribute("src", "https://example.com/m1.jpg");
    expect(screen.getByText("Ready for Feed, Stories and Reels")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Slash your power bill" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Logo" })).toBeInTheDocument();
    expect(screen.queryByText(/No photos or videos yet/)).not.toBeInTheDocument();
  });

  it("filters by tab: Photos is the owner's own, Made by AdBrain is the ads; no Videos tab until videos ship", () => {
    render(<MediaLibrary business={biz} media={[photo()]} creatives={[ad]} brandAssets={[logo]} />);
    expect(screen.queryByRole("tab", { name: "Videos" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Photos" }));
    const photos = screen.getByRole("tabpanel");
    expect(within(photos).getByRole("img", { name: "Finished kitchen" })).toBeInTheDocument();
    expect(within(photos).getByRole("img", { name: "Logo" })).toBeInTheDocument();
    expect(within(photos).queryByRole("img", { name: "Slash your power bill" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Made by AdBrain" }));
    const made = screen.getByRole("tabpanel");
    expect(within(made).getByRole("img", { name: "Slash your power bill" })).toBeInTheDocument();
    expect(within(made).queryByRole("img", { name: "Finished kitchen" })).not.toBeInTheDocument();
  });

  it("a photo without a name is titled Photo, and a signed URL that failed shows no broken tile actions", () => {
    render(<MediaLibrary business={biz} media={[photo({ name: null, url: null })]} creatives={[]} brandAssets={[]} />);
    expect(screen.getByText("Photo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("#1317: a prospect's sample ads keep no Download; the owner's own photos keep theirs", () => {
    render(<MediaLibrary business={biz} media={[photo()]} creatives={[ad]} brandAssets={[]} sample />);
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
  });
});
