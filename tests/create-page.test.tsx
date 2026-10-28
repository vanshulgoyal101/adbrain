// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Business } from "@/lib/types";

const getPrimaryBusiness = vi.hoisted(() => vi.fn());
const getBrandAssets = vi.hoisted(() => vi.fn(async () => [] as { type: string }[]));
// An owner whose campaign has gone live sees the full Create; a first-timer gets the setup step (#1270).
const hasLaunchedCampaign = vi.hoisted(() => vi.fn(async () => true));
const getLatestCreativeBatch = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness, getBrandAssets, hasLaunchedCampaign, getLatestCreativeBatch }));
vi.mock("@/components/setup-ads-step", () => ({ SetupAdsStep: () => <div>Setup step 2</div> }));
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

describe("Create page for a first-timer (#1270)", () => {
  it("is setup step 2 until a campaign has gone live; ?all=1 opens the full Create", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    hasLaunchedCampaign.mockResolvedValue(false);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    const { unmount } = render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Setup step 2")).toBeInTheDocument();
    unmount();
    render(await CreatePage({ searchParams: Promise.resolve({ all: "1" }) }));
    expect(screen.queryByText("Setup step 2")).toBeNull();
  });

  it("shows the full Create when the check fails", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    hasLaunchedCampaign.mockRejectedValue(new Error("down"));
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("Setup step 2")).toBeNull();
  });
});
