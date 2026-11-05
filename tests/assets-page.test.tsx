// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: async () => ({ id: "b1", name: "Sharma Interiors" }),
  getCreativePreviews: async () => [],
  getBrandAssets: async () => [],
}));
vi.mock("@/lib/prospect-session", () => ({ isProspectSession: async () => false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", async (original) => ({ ...await original<typeof import("next/navigation")>(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/media/consent", async (original) => ({ ...await original<Record<string, unknown>>(), hasCurrentMediaConsent: async () => { throw new Error("down"); } }));
const media = vi.hoisted(() => ({ on: false, video: false, list: vi.fn() }));
vi.mock("@/lib/media/store", () => ({ mediaUploadsEnabled: () => media.on, mediaVideoEnabled: () => media.on && media.video, listMedia: media.list }));

describe("Assets page (#778 slice 3a)", () => {
  it("is the old Assets page while uploads are off, and never reads media", async () => {
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    // One name for the page in both states (Designer, #778 walk item 4); the old page is told by its description.
    expect(screen.getByRole("heading", { name: "Photos" })).toBeInTheDocument();
    expect(screen.getByText(/Every ad and upload for/)).toBeInTheDocument();
    expect(media.list).not.toHaveBeenCalled();
  });

  it("with uploads on, is Photos; a failed read shows the empty state, not an error page", async () => {
    media.on = true;
    media.list.mockRejectedValueOnce(new Error("down"));
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    expect(screen.getByRole("heading", { name: "Photos" })).toBeInTheDocument();
    expect(media.list).toHaveBeenCalledWith({}, "b1");
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
  });

  it("?add=1 opens the upload sheet", async () => {
    media.on = true;
    media.list.mockResolvedValueOnce({ items: [], next: null });
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage({ searchParams: Promise.resolve({ add: "1" }) }));
    expect(screen.getByRole("dialog", { name: "Add photos" })).toBeInTheDocument();
  });

  it("uses the combined heading and upload entry when the server enables video", async () => {
    media.on = true;
    media.video = true;
    media.list.mockResolvedValueOnce({ items: [], next: null });
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    expect(screen.getByRole("heading", { name: "Photos & videos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos & videos" })).toBeInTheDocument();
  });

  it("keeps the rights confirmation available when video is enabled", async () => {
    media.on = true;
    media.video = true;
    media.list.mockResolvedValueOnce({ items: [], next: null });
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage({ searchParams: Promise.resolve({ confirm: "rights" }) }));
    expect(screen.getByRole("heading", { name: "Photos & videos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm your rights to the photos in your ads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
