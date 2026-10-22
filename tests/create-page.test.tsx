// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Business } from "@/lib/types";

const getPrimaryBusiness = vi.hoisted(() => vi.fn());
const getBrandAssets = vi.hoisted(() => vi.fn(async () => [] as { type: string }[]));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness, getBrandAssets }));
vi.mock("@/components/ad-assistant", () => ({ AdAssistant: () => <div>Assistant</div> }));

const sparse = {
  id: "b1",
  name: "New Bakery",
  description: "Fresh bread daily",
  brand_voice: null,
  target_audience: null,
  locations: [],
  offers: [],
  phone: null,
} as unknown as Business;

describe("Create page Brand context (#169)", () => {
  it("names the Brand facts a new business has not added yet", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage());
    expect(
      screen.getByText(
        "Not in your Brand yet: offers or prices, service areas, phone number. Ads only state facts your Brand has, so they will leave these out.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not added")).toHaveLength(5);
  });

  it("shows saved facts and no note when the Brand has them", async () => {
    getPrimaryBusiness.mockResolvedValue({
      ...sparse,
      offers: ["Rs 99 loaf"],
      locations: ["Jaipur"],
      phone: "+91 98765 43210",
    });
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage());
    expect(screen.getByText("Rs 99 loaf")).toBeInTheDocument();
    expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
    expect(screen.queryByText(/Not in your Brand yet/)).not.toBeInTheDocument();
  });

  it("asks for a logo and real photos until the Brand has them (#195)", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    const { unmount } = render(await CreatePage());
    expect(screen.getByText(/Add your logo and 1–3 real photos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add photos" })).toHaveAttribute("href", "/brand#brand-assets");
    unmount();

    getPrimaryBusiness.mockResolvedValue({ ...sparse, logo_url: "https://example.com/logo.png" });
    getBrandAssets.mockResolvedValue([{ type: "product_photo" }]);
    render(await CreatePage());
    expect(screen.queryByRole("link", { name: "Add photos" })).not.toBeInTheDocument();
  });
});
