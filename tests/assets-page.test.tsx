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
const media = vi.hoisted(() => ({ on: false, list: vi.fn() }));
vi.mock("@/lib/media/store", () => ({ mediaUploadsEnabled: () => media.on, listMedia: media.list }));

describe("Assets page (#778 slice 3a)", () => {
  it("is the old Assets page while uploads are off, and never reads media", async () => {
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(media.list).not.toHaveBeenCalled();
  });

  it("with uploads on, is Photos & videos; a failed read shows the empty state, not an error page", async () => {
    media.on = true;
    media.list.mockRejectedValueOnce(new Error("down"));
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    expect(screen.getByRole("heading", { name: "Photos & videos" })).toBeInTheDocument();
    expect(media.list).toHaveBeenCalledWith({}, "b1");
    expect(screen.getByRole("link", { name: "Add photos & videos" })).toBeInTheDocument();
  });
});
