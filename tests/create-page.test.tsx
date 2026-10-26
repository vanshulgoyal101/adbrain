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

describe("Create page business details (#169)", () => {
  it("names the Brand facts a new business has not added yet", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage());
    expect(
      screen.getByText("Not added yet: offers or prices, service areas, phone number. Ads leave these out."),
    ).toBeInTheDocument();
  });

  // #847: one line points to Your business instead of repeating its facts.
  it("links to Your business and has no note when the facts are there", async () => {
    getPrimaryBusiness.mockResolvedValue({
      ...sparse,
      offers: ["Rs 99 loaf"],
      locations: ["Jaipur"],
      phone: "+91 98765 43210",
    });
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage());
    expect(screen.getByText(/Using New Bakery's details/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit your business" })).toHaveAttribute("href", "/brand");
    expect(screen.queryByText("Rs 99 loaf")).not.toBeInTheDocument();
    expect(screen.queryByText(/Not added yet/)).not.toBeInTheDocument();
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
