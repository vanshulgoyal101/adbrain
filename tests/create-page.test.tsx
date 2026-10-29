// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Business } from "@/lib/types";

const getPrimaryBusiness = vi.hoisted(() => vi.fn());
const getBrandAssets = vi.hoisted(() => vi.fn(async () => [] as { type: string }[]));
// An owner whose campaign has gone live sees the full Create; a first-timer gets the setup step (#1270).
const hasLaunchedCampaign = vi.hoisted(() => vi.fn(async () => true));
const getSetupCreativeBatch = vi.hoisted(() => vi.fn(async () => ({ ads: [], newest: null })));
const getApprovedCreatives = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness, getBrandAssets, hasLaunchedCampaign, getSetupCreativeBatch, getApprovedCreatives }));
const setupProps = vi.hoisted(() => vi.fn());
vi.mock("@/components/setup-ads-step", () => ({ SetupAdsStep: (props: unknown) => { setupProps(props); return <div>Setup step 2</div>; } }));
const mediaOn = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/media/store", () => ({ mediaUploadsEnabled: () => mediaOn.value }));
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

  it("#778: with uploads on, offers the entry choice: Make ads with AI · Use my photos & videos; off, no choice", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    const { unmount } = render(await CreatePage());
    expect(screen.queryByRole("navigation", { name: "How to make ads" })).not.toBeInTheDocument();
    unmount();
    mediaOn.value = true;
    try {
      render(await CreatePage());
      expect(screen.getByText("Make ads with AI")).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Use my photos & videos" })).toHaveAttribute("href", "/assets");
    } finally { mediaOn.value = false; }
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
  const usable = { ...sparse, vertical: "Bakery", locations: ["Jaipur"], offers: ["Free cake"], phone: "9876543210" } as unknown as Business;

  it("is setup step 2 until a campaign has gone live; ?all=1 opens the full Create", async () => {
    getPrimaryBusiness.mockResolvedValue(usable);
    hasLaunchedCampaign.mockResolvedValue(false);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    const { unmount } = render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Setup step 2")).toBeInTheDocument();
    unmount();
    render(await CreatePage({ searchParams: Promise.resolve({ all: "1" }) }));
    expect(screen.queryByText("Setup step 2")).toBeNull();
  });

  it("#1432: step 2 offers only ads made from today's step 1; older ones get new ads made", async () => {
    getPrimaryBusiness.mockResolvedValue(usable);
    hasLaunchedCampaign.mockResolvedValue(false);
    const { setupGoal } = await import("@/lib/creative/setup-picks");
    const made = (id: string, goal: string) => ({ id, headline: id, generation: { sourceFacts: [goal] } });
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    getSetupCreativeBatch.mockResolvedValue({ ads: [made("solar", "Get WhatsApp enquiries for rooftop solar in Mohali, leading with: Free site survey")], newest: null } as never);
    const { unmount } = render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(setupProps.mock.lastCall?.[0]).toMatchObject({ initialAds: [] });
    unmount();
    getSetupCreativeBatch.mockResolvedValue({ ads: [made("today", setupGoal(usable))], newest: null } as never);
    render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(setupProps.mock.lastCall?.[0].initialAds).toEqual([expect.objectContaining({ id: "today" })]);
  });

  it("shows the full Create when the check fails", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    hasLaunchedCampaign.mockRejectedValue(new Error("down"));
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("Setup step 2")).toBeNull();
  });

  it("#1475: earlier ads (Studio-made, or from older details) reach step 2 as 'earlier', so nothing paid auto-starts", async () => {
    getPrimaryBusiness.mockResolvedValue(usable);
    hasLaunchedCampaign.mockResolvedValue(false);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    getSetupCreativeBatch.mockResolvedValue({ ads: [{ id: "old", generation: { sourceFacts: ["older details"] } }], newest: null } as never);
    const { unmount } = render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(setupProps.mock.lastCall?.[0]).toMatchObject({ initialAds: [], earlier: true });
    unmount();
    getSetupCreativeBatch.mockResolvedValue({ ads: [], newest: null });
    getApprovedCreatives.mockResolvedValue([{ id: "studio" }] as never);
    const second = render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(setupProps.mock.lastCall?.[0]).toMatchObject({ initialAds: [], earlier: true });
    second.unmount();
    getApprovedCreatives.mockResolvedValue([]);
    render(await CreatePage({ searchParams: Promise.resolve({}) }));
    expect(setupProps.mock.lastCall?.[0]).toMatchObject({ initialAds: [], earlier: false });
  });

  it("#1934: after a launch, ?again=1 runs step 2 again (the owner just tapped Make my ads), never 'earlier'", async () => {
    getPrimaryBusiness.mockResolvedValue(usable);
    hasLaunchedCampaign.mockResolvedValue(true);
    getSetupCreativeBatch.mockResolvedValue({ ads: [{ id: "old", generation: { sourceFacts: ["older details"] } }], newest: null } as never);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    render(await CreatePage({ searchParams: Promise.resolve({ again: "1" }) }));
    expect(setupProps.mock.lastCall?.[0]).toMatchObject({ initialAds: [], earlier: false, again: true });
  });

  it("+ lands here; a first-timer without the five facts resumes at step 1 (#1272)", async () => {
    getPrimaryBusiness.mockResolvedValue(sparse);
    hasLaunchedCampaign.mockResolvedValue(false);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    await expect(CreatePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  });

  it("no service area is not usable: step 2 sends the first-timer back to step 1 (#1136 CEO)", async () => {
    getPrimaryBusiness.mockResolvedValue({ ...usable, locations: [" "] });
    hasLaunchedCampaign.mockResolvedValue(false);
    const { default: CreatePage } = await import("@/app/(app)/create/page");
    await expect(CreatePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  });

});
