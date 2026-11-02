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
vi.mock("@/lib/media/consent", async (original) => ({ ...await original<Record<string, unknown>>(), hasCurrentMediaConsent: async () => { throw new Error("down"); } }));
const media = vi.hoisted(() => ({ on: false, list: vi.fn(), resultsOn: false, results: vi.fn() }));
vi.mock("@/lib/media/store", () => ({ mediaUploadsEnabled: () => media.on, listMedia: media.list }));
vi.mock("@/lib/campaign/ad-results-store", () => ({ adResultsEnabled: () => media.resultsOn }));
vi.mock("@/lib/campaign/asset-results-store", () => ({ readAssetResults: media.results }));
vi.mock("@/i18n/request-locale", () => ({ requestWords: async () => undefined }));

describe("Assets page (#778 slice 3a)", () => {
  it("is the old Assets page while uploads are off, and never reads media", async () => {
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    render(await AssetsPage());
    expect(screen.getByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(media.list).not.toHaveBeenCalled();
    expect(media.results).not.toHaveBeenCalled();
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

  it("reads owner-scoped results with either library, independently of uploads", async () => {
    media.resultsOn = true;
    media.results.mockResolvedValue({ state: "unavailable" });
    const { default: AssetsPage } = await import("@/app/(app)/assets/page");
    for (const on of [false, true]) {
      media.on = on;
      media.list.mockResolvedValue({ items: [], next: null });
      const { unmount } = render(await AssetsPage());
      expect(media.results).toHaveBeenLastCalledWith({}, "b1");
      expect(screen.getByRole("status")).toHaveTextContent("Results couldn't be loaded.");
      unmount();
    }
    media.resultsOn = false;
  });
});
