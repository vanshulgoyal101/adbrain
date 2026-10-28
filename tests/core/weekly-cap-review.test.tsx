// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { weeklyCapWords } from "@/components/weekly-cap-line";
import { weeklyCapNotice, wouldExceedCap, type CampaignSpend } from "@/lib/campaign/spend";
import type { Business, Campaign, Creative } from "@/lib/types";

// #1342 (QA 2, #1334 walk): the Settings weekly cap shows at Review and refuses an over-cap budget where it's typed.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const live = (id: string, dailyBudget: number | null): CampaignSpend => ({ id, status: "active", dailyBudget, spend: 0 });

describe("core: weekly cap projection (#1342)", () => {
  it("QA's case: a ₹2,000 cap and ₹300 a day is ₹2,100 a week, over", () => {
    expect(weeklyCapNotice([], 300, 2000)).toEqual({ capRupees: 2000, projectedWeekly: 2100, exceeds: true });
  });

  it("adds the live campaigns' budgets, as Activate does", () => {
    expect(weeklyCapNotice([live("a", 100)], 150, 2000)).toEqual({ capRupees: 2000, projectedWeekly: 1750, exceeds: false });
    expect(weeklyCapNotice([live("a", 100)], 200, 2000)).toEqual({ capRupees: 2000, projectedWeekly: 2100, exceeds: true });
  });

  it("agrees with the server's refusal for every budget", () => {
    for (const daily of [50, 285, 286, 300, 1000]) {
      const server = wouldExceedCap([], daily, 2000);
      expect(weeklyCapNotice([], daily, 2000)?.exceeds).toBe(server.exceeds);
    }
  });

  it("nothing to show without a cap; cap only when the week can't be worked out", () => {
    expect(weeklyCapNotice([], 300, null)).toBeNull();
    expect(weeklyCapNotice([live("a", null)], 300, 2000)).toEqual({ capRupees: 2000, projectedWeekly: null, exceeds: false });
  });

  it("words: the cap, the week, and what to do when over", () => {
    expect(weeklyCapWords({ capRupees: 2000, projectedWeekly: 2100, exceeds: true }))
      .toBe("Your weekly cap: ₹2,000 · with this campaign, about ₹2,100 a week, over the cap. Lower the daily budget or raise the cap in Settings.");
    expect(weeklyCapWords({ capRupees: 2000, projectedWeekly: 1400, exceeds: false }))
      .toBe("Your weekly cap: ₹2,000 · with this campaign, about ₹1,400 a week.");
  });
});

describe("core: Review shows the cap (#1342)", () => {
  const review = (weeklyCap: Parameters<typeof CampaignLaunchReview>[0]["weeklyCap"]) => render(
    <CampaignLaunchReview selectedCount={2} budget={300} destination="whatsapp" whatsappNumber="98•••••210" audience="Jaipur" weeklyCap={weeklyCap} />);

  it("over the cap: says so and isn't ready", () => {
    review(weeklyCapNotice([], 300, 2000));
    expect(screen.getByText(/Your weekly cap: ₹2,000 · with this campaign, about ₹2,100 a week, over the cap/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.queryByText("Ready for campaign review")).toBeNull();
  });

  it("under the cap: shows it and stays ready", () => {
    review(weeklyCapNotice([], 200, 2000));
    expect(screen.getByText("Your weekly cap: ₹2,000 · with this campaign, about ₹1,400 a week.")).toBeTruthy();
    expect(screen.getByText("Ready for campaign review")).toBeTruthy();
  });

  it("no cap: no line", () => {
    review(null);
    expect(screen.queryByText(/weekly cap/)).toBeNull();
  });
});

describe("core: the composer refuses an over-cap budget where it's typed (#1342)", () => {
  const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "SunPeak Solar", locations: ["Jaipur"] } as Business;
  const ad = { id: "22222222-2222-4222-8222-222222222222", business_id: business.id, headline: "Rooftop solar", primary_text: "Text", cta: "Book Now", image_url: "/icon.png", status: "approved" } as Creative;

  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
    mocks.drafts.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [], results: {}, nextCursor: null })));
  });

  function composer(active: Campaign[] = []) {
    render(<Campaigns business={business} approved={[ad]} initialCampaigns={active} initialResults={{}} leadForms={[]} leadFormError={null}
      metaReady={false} adAccountId="" newCampaign={{ creativeIds: [ad.id] }}
      weeklyCap={{ capRupees: 2000, active: active.map(c => live(c.id, c.daily_budget)) }} />);
  }

  it("₹300 a day against a ₹2,000 cap: the budget field says so and Check my campaign doesn't proceed", async () => {
    composer();
    await waitFor(() => expect(mocks.drafts).toHaveBeenCalled());
    expect(document.getElementById("budget-cap")?.textContent).toMatch(/about ₹2,100 a week, over the cap/);
    expect(document.getElementById("budget")!.getAttribute("aria-describedby")).toBe("budget-cap");
    fireEvent.click(screen.getByRole("button", { name: /Check my campaign/ }));
    await waitFor(() => expect(document.getElementById("budget-error")?.textContent).toMatch(/over the cap/));
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("lowering the budget to ₹250 a day clears the refusal", async () => {
    composer();
    await waitFor(() => expect(mocks.drafts).toHaveBeenCalled());
    fireEvent.change(document.getElementById("budget")!, { target: { value: "250" } });
    expect(document.getElementById("budget-cap")).toBeNull();
    expect(screen.getByText("Your weekly cap: ₹2,000 · with this campaign, about ₹1,750 a week.")).toBeTruthy();
  });

  it("counts a live campaign already on", async () => {
    composer([{ id: "c1", business_id: business.id, name: "Live", status: "active", daily_budget: 100 } as Campaign]);
    await waitFor(() => expect(mocks.drafts).toHaveBeenCalled());
    fireEvent.change(document.getElementById("budget")!, { target: { value: "150" } });
    expect(screen.getByText("Your weekly cap: ₹2,000 · with this campaign, about ₹1,750 a week.")).toBeTruthy();
  });
});
