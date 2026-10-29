// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupGoal } from "@/lib/creative/setup-picks";
import type { Business } from "@/lib/types";

// #1551 (QA red test for #1475): the real Create page renders the real step 2, so this covers the page's 'earlier'
// decision and the step's mount together. Only data and the network are faked; a paid batch is any POST to the
// Create APIs. The control case (a true first-timer) proves the spy sees an automatic batch when one should start.
const queries = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  getBrandAssets: vi.fn(async () => []),
  hasLaunchedCampaign: vi.fn(async () => false),
  getSetupCreativeBatch: vi.fn(),
  getApprovedCreatives: vi.fn(),
}));
vi.mock("@/lib/supabase/queries", () => queries);
vi.mock("@/lib/prospect-session", () => ({ isProspectSession: async () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn() }));
vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

const bakery = { id: "11111111-1111-4111-8111-111111111111", name: "Sweet Crumbs Bakery", vertical: "Eggless cakes",
  locations: ["Mohali"], offers: ["Flat 10% off your first cake"], phone: "9814000000", languages: [] } as unknown as Business;
const madeFrom = (id: string, goal: string) => ({ id, business_id: bakery.id, headline: id, image_url: `/ads/${id}.png`,
  status: "approved", generation: { sourceFacts: [goal] } });

const paidPosts = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  .filter(([url, init]) => (init?.method ?? "GET") === "POST" && String(url).startsWith("/api/creatives/"))
  .map(([url]) => String(url).split("?")[0]);

async function openStepTwo(business: Business) {
  queries.getPrimaryBusiness.mockResolvedValue(business);
  const { default: CreatePage } = await import("@/app/(app)/create/page");
  render(await CreatePage({ searchParams: Promise.resolve({}) }));
  // Let mount effects and any started request run.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

describe("core: opening step 2 never starts a paid Create batch without a tap (#1551, #1475)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    queries.getSetupCreativeBatch.mockResolvedValue({ ads: [], newest: null });
    queries.getApprovedCreatives.mockResolvedValue([]);
    // Any Create call answers 'not ready', so a started batch stops after its first request.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "test" }, { status: 503 })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("control: a true first-timer (no ads anywhere) does start on its own, so the spy sees a batch", async () => {
    await openStepTwo(bakery);
    expect(paidPosts().length).toBeGreaterThan(0);
  });

  const cases: Array<[string, () => void, Business]> = [
    ["ads made from an older step 1 (another business's goal)", () => queries.getSetupCreativeBatch.mockResolvedValue({
      ads: [madeFrom("solar", "Get WhatsApp enquiries for Rooftop solar in Zirakpur, leading with: Free site survey")], newest: null }), bakery],
    ["a Brand edit after the ads were made (the offer changed)", () => queries.getSetupCreativeBatch.mockResolvedValue({
      ads: [madeFrom("before", setupGoal(bakery))], newest: null }), { ...bakery, offers: ["Free delivery in Kharar"] } as Business],
    ["only Studio-approved ads, no setup batch", () => queries.getApprovedCreatives.mockResolvedValue([madeFrom("studio", "")]), bakery],
    ["the approved-ads read fails (counts as earlier)", () => queries.getApprovedCreatives.mockRejectedValue(new Error("down")), bakery],
  ];

  it.each(cases)("%s: no Create POST until 'Make 3 ads' is tapped, then a batch starts", async (_name, arrange, business) => {
    arrange();
    await openStepTwo(business);
    expect(paidPosts()).toEqual([]);
    const make = within(screen.getByRole("navigation", { name: "Setup steps" })).getByRole("button", { name: "Make 3 ads" });
    await act(async () => { fireEvent.click(make); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(paidPosts().length).toBeGreaterThan(0);
  });
});
