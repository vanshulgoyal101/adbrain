// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CampaignsPage from "@/app/(app)/campaigns/page";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";
import type { MetaConnection } from "@/lib/meta/credentials";

const reads = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  getCampaignPage: vi.fn(),
  getLatestResultsWithEnquiries: vi.fn(),
  getApprovedCreatives: vi.fn(),
  getSpendLimits: vi.fn(),
  getActiveCampaignBudgets: vi.fn(),
  getMetaConnection: vi.fn(),
  ledgerTotals: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  canUseMetaConnect: vi.fn(),
  fundingMode: vi.fn(),
  isProspectSession: vi.fn(),
  requestWords: vi.fn(),
  setupWords: vi.fn(),
  metaWaitFor: vi.fn(),
  campaigns: vi.fn(),
}));

vi.mock("@/lib/supabase/queries", () => reads);
vi.mock("@/lib/meta/credentials", () => ({ getMetaConnection: reads.getMetaConnection }));
vi.mock("@/lib/campaign/ledger", () => ({ ledgerTotals: reads.ledgerTotals }));
vi.mock("@/lib/meta/connection-access", () => ({ requireOwnedBusiness: reads.requireOwnedBusiness }));
vi.mock("@/lib/supabase/server", () => ({ createClient: reads.createClient }));
vi.mock("@/lib/meta/pilot-access", () => ({
  canUseMetaConnect: reads.canUseMetaConnect,
  metaAppReviewPending: () => true,
}));
vi.mock("@/lib/payments/operator-funding", () => ({ fundingMode: reads.fundingMode }));
vi.mock("@/lib/prospect-session", () => ({ isProspectSession: reads.isProspectSession }));
vi.mock("@/i18n/request-locale", () => ({
  requestWords: reads.requestWords,
  setupWords: reads.setupWords,
}));
vi.mock("@/services/meta-throttle", () => ({ metaWaitFor: reads.metaWaitFor }));
vi.mock("@/lib/internal-accounts", async (actual) => ({
  ...(await actual<typeof import("@/lib/internal-accounts")>()),
  isInternalUser: (user: { id: string } | null) => user?.id === "team-user",
}));
vi.mock("@/components/campaigns", () => ({
  Campaigns: (props: { internal: boolean; metaWaitUntil: string | null }) => {
    reads.campaigns(props);
    return <p>Campaigns loaded; internal: {String(props.internal)}; wait: {props.metaWaitUntil ?? "none"}</p>;
  },
}));
vi.mock("@/components/setup-go-live", () => ({
  SetupGoLive: ({ words }: { words: { locale: string } }) => <p>Go live; language: {words.locale}</p>,
}));
vi.mock("@/components/ready-ads-next-step", () => ({
  ReadyAdsNextStep: ({ words }: { words: { locale: string } }) => <p>Ready ads; language: {words.locale}</p>,
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  redirect: (to: string) => { throw new Error(`redirect:${to}`); },
}));

const business: Business = {
  id: "business-1", owner_id: "owner-1", name: "SunPeak", vertical: "solar energy",
  website: null, description: null, brand_voice: null, primary_color: null, secondary_color: null,
  font: null, languages: ["English"], locations: ["Jaipur"], target_audience: null,
  usps: [], offers: [], logo_url: null, phone: "98765 43210", email: null,
  whatsapp_template: null, address: null, created_at: "2026-01-01", updated_at: "2026-01-01",
};
const creative: Creative = {
  id: "creative-1", business_id: business.id, brief: "Solar", angle: null, image_url: null,
  headline: "Solar", primary_text: null, cta: null, variant_group: null, status: "approved",
  generation: { sourceFacts: ["Get WhatsApp enquiries for solar energy in Jaipur"] },
  created_at: "2026-01-01", updated_at: "2026-01-01",
};
const campaign: Campaign = {
  id: "campaign-1", business_id: business.id, name: "Solar", objective: "OUTCOME_LEADS",
  daily_budget: 500, status: "paused", meta_campaign_id: "meta-campaign",
  meta_adset_id: null, meta_ad_ids: [], meta_ad_account_id: null, meta_page_id: null,
  meta_connection_generation: null, creative_ids: [], raw: null,
  launched_at: null, created_at: "2026-01-01T00:00:00Z",
};
const result: CampaignResult = {
  id: "result-1", campaign_id: campaign.id, impressions: 100, clicks: 10,
  leads: 3, spend: 300, cpl: 100, fetched_at: "2026-01-02T00:00:00Z",
};
const connection: MetaConnection = {
  source: "oauth", pending: false, ready: true, adAccountId: "account", pageId: "page",
  tokenExpiresAt: null, expired: false, scopes: [],
};
const user = { id: "team-user", email: "team@example.test", email_confirmed_at: "2026-01-01" };
const waitUntil = "2026-11-04T10:00:00Z";

type Namespace = "campaigns" | "verdict" | "whatsappMessage";

function words(namespace: Namespace, locale: "en" | "hi" = "en") {
  return { locale, messages: (locale === "en" ? en : hi)[namespace] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function delay<T>(value: T, ms: number) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
}

function campaignPage(params: Record<string, string> = {}) {
  return CampaignsPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reads.getPrimaryBusiness.mockResolvedValue(business);
  reads.getCampaignPage.mockResolvedValue({ campaigns: [campaign], nextCursor: "next-page" });
  reads.getLatestResultsWithEnquiries.mockResolvedValue({ [campaign.id]: result });
  reads.getApprovedCreatives.mockResolvedValue([]);
  reads.getSpendLimits.mockResolvedValue({ weeklyCapRupees: 2000 });
  reads.getActiveCampaignBudgets.mockResolvedValue([]);
  reads.getMetaConnection.mockResolvedValue(connection);
  reads.ledgerTotals.mockResolvedValue(null);
  reads.requireOwnedBusiness.mockRejectedValue(new Error("No saved drafts."));
  reads.createClient.mockResolvedValue({ auth: { getUser: reads.getUser } });
  reads.getUser.mockResolvedValue({ data: { user }, error: null });
  reads.canUseMetaConnect.mockReturnValue(false);
  reads.fundingMode.mockResolvedValue("managed");
  reads.isProspectSession.mockResolvedValue(false);
  reads.requestWords.mockImplementation((namespace: Namespace) => Promise.resolve(words(namespace)));
  reads.setupWords.mockResolvedValue({ locale: "en", messages: en.setup });
  reads.metaWaitFor.mockResolvedValue(waitUntil);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("core: Campaigns page read concurrency (#2854)", () => {
  it("starts language and user reads while business-scoped data is pending", async () => {
    const approved = deferred<Creative[]>();
    const started = deferred<void>();
    reads.getApprovedCreatives.mockImplementation(() => {
      started.resolve();
      return approved.promise;
    });
    const page = campaignPage({ all: "1" });
    try {
      await started.promise;
      expect(reads.requestWords).toHaveBeenCalledWith("campaigns");
      expect(reads.requestWords).toHaveBeenCalledWith("verdict");
      expect(reads.requestWords).toHaveBeenCalledWith("whatsappMessage");
      expect(reads.setupWords).toHaveBeenCalledOnce();
      expect(reads.getUser).toHaveBeenCalledOnce();
    } finally {
      approved.resolve([]);
      await page;
    }
  });

  it("starts the Meta wait read as soon as campaign rows arrive, before results finish", async () => {
    const results = deferred<Record<string, CampaignResult>>();
    const started = deferred<void>();
    reads.getLatestResultsWithEnquiries.mockImplementation(() => {
      started.resolve();
      return results.promise;
    });
    const page = campaignPage({ all: "1" });
    try {
      await started.promise;
      await Promise.resolve();
      expect(reads.metaWaitFor).toHaveBeenCalledWith(business.id);
    } finally {
      results.resolve({ [campaign.id]: result });
      render(await page);
    }
    expect(screen.getByText(`Campaigns loaded; internal: true; wait: ${waitUntil}`)).toBeInTheDocument();
  });

  it("reuses one verified user for the connect gate and internal campaign controls", async () => {
    reads.getMetaConnection.mockResolvedValue({ ...connection, ready: false });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    render(await campaignPage({ again: "1" }));
    expect(screen.getByText(`Campaigns loaded; internal: true; wait: ${waitUntil}`)).toBeInTheDocument();
    expect(reads.canUseMetaConnect).toHaveBeenCalledWith(user.id);
    expect(reads.getUser).toHaveBeenCalledOnce();
  });

  it("finishes overlapping synthetic reads within the 1.2-second budget", async () => {
    vi.useFakeTimers();
    reads.getPrimaryBusiness.mockImplementation(() => delay(business, 100));
    reads.getCampaignPage.mockImplementation(() => delay({ campaigns: [campaign], nextCursor: "next-page" }, 200));
    reads.getLatestResultsWithEnquiries.mockImplementation(() => delay({ [campaign.id]: result }, 350));
    reads.getApprovedCreatives.mockImplementation(() => delay([], 500));
    reads.getMetaConnection.mockImplementation(() => delay(connection, 400));
    reads.getSpendLimits.mockImplementation(() => delay({ weeklyCapRupees: 2000 }, 200));
    reads.getActiveCampaignBudgets.mockImplementation(() => delay([], 200));
    reads.ledgerTotals.mockImplementation(() => delay(null, 50));
    reads.requestWords.mockImplementation((namespace: Namespace) => delay(words(namespace), 250));
    reads.setupWords.mockImplementation(() => delay({ locale: "en", messages: en.setup }, 250));
    reads.getUser.mockImplementation(() => delay({ data: { user }, error: null }, 500));
    reads.metaWaitFor.mockImplementation(() => delay(waitUntil, 400));
    const start = Date.now();
    let elapsed = Infinity;
    const page = campaignPage({ all: "1" });
    void page.then(() => { elapsed = Date.now() - start; }, () => {});
    try {
      await vi.advanceTimersByTimeAsync(1199);
      expect(elapsed).toBeLessThan(1200);
    } finally {
      await vi.runAllTimersAsync();
      await page;
    }
  });

  it("does not await unrelated language or user reads before first-time Go live", async () => {
    vi.useFakeTimers();
    const verdict = deferred<ReturnType<typeof words>>();
    const pendingUser = deferred<{ data: { user: typeof user }; error: null }>();
    reads.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    reads.requestWords.mockImplementation((namespace: Namespace) =>
      namespace === "verdict" ? verdict.promise : Promise.resolve(words(namespace)));
    reads.getUser.mockReturnValue(pendingUser.promise);
    let settled = false;
    const page = campaignPage();
    void page.then(() => { settled = true; }, () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      render(await page);
      expect(screen.getByText("Go live; language: en")).toBeInTheDocument();
    } finally {
      verdict.resolve(words("verdict"));
      pendingUser.resolve({ data: { user }, error: null });
      await page;
    }
  });

  it("reports an unused language failure without blocking first-time Go live", async () => {
    reads.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    reads.requestWords.mockImplementation((namespace: Namespace) =>
      namespace === "verdict" ? Promise.reject(new Error("Verdict language unavailable.")) : Promise.resolve(words(namespace)));
    render(await campaignPage());
    expect(screen.getByText("Go live; language: en")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("[campaigns.verdictWords]", "Verdict language unavailable.");
  });

  it("reports a speculative failure that arrives after Go live renders", async () => {
    const verdict = deferred<ReturnType<typeof words>>();
    reads.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    reads.requestWords.mockImplementation((namespace: Namespace) =>
      namespace === "verdict" ? verdict.promise : Promise.resolve(words(namespace)));
    render(await campaignPage());
    verdict.reject(new Error("Verdict language unavailable."));
    await Promise.resolve();
    expect(console.error).toHaveBeenCalledWith("[campaigns.verdictWords]", "Verdict language unavailable.");
    expect(screen.getByText("Go live; language: en")).toBeInTheDocument();
  });

  it("does not await unrelated words before showing the ready-ads step", async () => {
    vi.useFakeTimers();
    const verdict = deferred<ReturnType<typeof words>>();
    reads.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    reads.getMetaConnection.mockResolvedValue({ ...connection, ready: false });
    reads.requestWords.mockImplementation((namespace: Namespace) =>
      namespace === "verdict" ? verdict.promise : Promise.resolve(words(namespace)));
    let settled = false;
    const page = campaignPage();
    void page.then(() => { settled = true; }, () => {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      render(await page);
      expect(screen.getByText("Ready ads; language: en")).toBeInTheDocument();
    } finally {
      verdict.resolve(words("verdict"));
      await page;
    }
  });

  it("still rejects when a required Campaigns language read fails", async () => {
    reads.requestWords.mockImplementation((namespace: Namespace) =>
      namespace === "verdict" ? Promise.reject(new Error("Verdict language unavailable.")) : Promise.resolve(words(namespace)));
    await expect(campaignPage({ all: "1" })).rejects.toThrow("Verdict language unavailable.");
  });

  it("keeps the existing empty-business page without starting business-scoped reads", async () => {
    reads.getPrimaryBusiness.mockResolvedValue(null);
    render(await campaignPage());
    expect(screen.getByRole("link", { name: "Set up your business" })).toHaveAttribute("href", "/brand");
    expect(reads.getCampaignPage).not.toHaveBeenCalled();
    expect(reads.metaWaitFor).not.toHaveBeenCalled();
    expect(reads.getUser).not.toHaveBeenCalled();
  });

  it("does not read the Meta wait for campaigns without a Meta id", async () => {
    reads.getCampaignPage.mockResolvedValue({ campaigns: [{ ...campaign, meta_campaign_id: null }], nextCursor: null });
    render(await campaignPage({ all: "1" }));
    expect(screen.getByText("Campaigns loaded; internal: true; wait: none")).toBeInTheDocument();
    expect(reads.metaWaitFor).not.toHaveBeenCalled();
  });

  it("keeps language, results, cursor and throttle data in the Campaigns props", async () => {
    reads.requestWords.mockImplementation((namespace: Namespace) => Promise.resolve(words(namespace, "hi")));
    render(await campaignPage({ all: "1" }));
    expect(reads.getLatestResultsWithEnquiries).toHaveBeenCalledWith([campaign.id]);
    expect(reads.campaigns).toHaveBeenCalledWith(expect.objectContaining({
      business, initialCampaigns: [campaign], initialNextCursor: "next-page",
      initialResults: { [campaign.id]: result }, metaWaitUntil: waitUntil,
      campaignWords: words("campaigns", "hi"), verdictWords: words("verdict", "hi"),
      whatsappWords: words("whatsappMessage", "hi"),
    }));
  });

  it("fails closed for connect and internal controls when the user read fails", async () => {
    reads.getMetaConnection.mockResolvedValue({ ...connection, ready: false });
    reads.getApprovedCreatives.mockResolvedValue([creative]);
    reads.getUser.mockRejectedValue(new Error("User unavailable."));
    render(await campaignPage({ again: "1" }));
    expect(screen.getByText(`Campaigns loaded; internal: false; wait: ${waitUntil}`)).toBeInTheDocument();
    expect(reads.canUseMetaConnect).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[campaigns.user]", "User unavailable.");
  });

  it("reports a resolved Supabase auth error while failing closed", async () => {
    reads.getUser.mockResolvedValue({ data: { user: null }, error: new Error("User unavailable.") });
    render(await campaignPage({ all: "1" }));
    expect(screen.getByText(`Campaigns loaded; internal: false; wait: ${waitUntil}`)).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("[campaigns.user]", "User unavailable.");
  });

  it("does not trust a user returned alongside an auth error", async () => {
    reads.getUser.mockResolvedValue({ data: { user }, error: new Error("User unavailable.") });
    render(await campaignPage({ all: "1" }));
    expect(screen.getByText(`Campaigns loaded; internal: false; wait: ${waitUntil}`)).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("[campaigns.user]", "User unavailable.");
  });

  it("still rejects when a required Meta wait read fails", async () => {
    reads.metaWaitFor.mockRejectedValue(new Error("Meta wait unavailable."));
    await expect(campaignPage({ all: "1" })).rejects.toThrow("Meta wait unavailable.");
    expect(console.error).toHaveBeenCalledWith("[campaigns.metaWait]", "Meta wait unavailable.");
  });
});
