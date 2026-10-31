// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecentActivity, WorkspaceHome } from "@/components/workspace-home";
import { DEFAULT_SPEND_LIMITS, evaluateSpend } from "@/lib/campaign/spend";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";

const queries = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  getCreatives: vi.fn(),
  getCreativePreviews: vi.fn(),
  getAuditLog: vi.fn(),
  getCampaigns: vi.fn(),
  getCampaignPage: vi.fn(),
  getSpendLimits: vi.fn(async () => ({ weeklyCapRupees: null, alertPct: 80, autoPause: false })),
  getActiveCampaignBudgets: vi.fn(async () => []),
  hasLaunchedCampaign: vi.fn(async () => true),
  getApprovedCreatives: vi.fn(),
  getLatestResults: vi.fn(),
  getLatestResultsWithEnquiries: vi.fn(),
  getSpendEvaluation: vi.fn(),
  getMetaConnection: vi.fn(),
  getAdStatuses: vi.fn(async () => ({})),
  getUser: vi.fn(),
  businessLLMUsageSummary: vi.fn(),
}));
vi.mock("@/lib/supabase/queries", () => queries);
// #1670: the owner's pending hand-over; none unless a test sets one.
const transfer = vi.hoisted(() => ({ myPendingTransfer: vi.fn(async () => null as unknown) }));
vi.mock("@/lib/prospect/transfer-server", () => ({ myPendingTransfer: transfer.myPendingTransfer, repTransferState: vi.fn() }));
// #1668: the "last week" card has its own tests; here it reads nothing.
vi.mock("@/lib/home/week-summary-load", () => ({ loadWeekSummary: async () => null }));
// #1650: the day-7 question's facts (exempt, first Go live, earlier answers); hidden unless a test opens it.
const pilot = vi.hoisted(() => ({ facts: vi.fn(async (): Promise<{ exempt: boolean; firstLaunchAt: string | null; events: { name: string; created_at: string }[] }> => ({ exempt: true, firstLaunchAt: null, events: [] })) }));
vi.mock("@/lib/feedback/pilot-day7-store", () => ({ pilotDay7Facts: pilot.facts }));
// #2036: the weekly results card's facts; not offered unless a test offers it.
const card = vi.hoisted(() => ({ facts: vi.fn(async () => ({ offered: false, enquiries: 0, area: null as string | null })) }));
vi.mock("@/lib/results-card/store", () => ({
  resultsCardFacts: card.facts,
  resultsCardLines: () => ({ main: "6 people in Sector 70 enquired with us this week", contact: null }),
}));
vi.mock("@/lib/llm/persist", () => ({ businessLLMUsageSummary: queries.businessLLMUsageSummary }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ DEMO_USER_EMAIL: "demo@example.test", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }) }));
const operator = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/privacy-requests", () => ({ privacyOperatorAllowed: async () => operator.allowed }));
vi.mock("@/components/studio", () => ({ Studio: () => <div>Studio loaded</div> }));
// #1003: Home refreshes stale live results in the background and re-renders through the router.
vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/campaigns", () => ({ Campaigns: () => <div>Campaigns loaded</div> }));
vi.mock("@/components/meta-connection", () => ({ MetaConnectionPanel: () => <div>Connection loaded</div> }));
vi.mock("@/components/spend-guardrails", () => ({ SpendGuardrails: () => <div>Guardrails loaded</div> }));
vi.mock("@/lib/meta/oauth", () => ({ metaOAuthConfigured: () => true }));
vi.mock("@/components/demo-llm-usage", () => ({ DemoLlmUsage: () => <div>Usage loaded</div> }));
vi.mock("@/lib/meta/credentials", () => ({
  getMetaConnection: queries.getMetaConnection,
}));

const business = {
  id: "business",
  name: "Local services",
  vertical: "Home services",
  description: "Repairs",
  brand_voice: null,
  target_audience: "Homeowners",
  locations: ["Jaipur"],
} as Business;
// A campaign that went live once (#672), so Home is the normal Home, not the first-ad resume card (#1272).
const wentLive = { id: "c-live", status: "paused", launched_at: "2026-10-01T10:00:00Z", meta_campaign_id: null } as unknown as Campaign;
const creative = {
  id: "draft-1",
  status: "draft",
  headline: "A home worth caring for",
  image_url: null,
} as Creative;
const empty = {
  business: null,
  creatives: [],
  campaigns: [],
  audit: [],
  metaReady: false,
  spend: null,
};


// #403 S5: Settings sections sit in layout columns; each still streams in its own Suspense boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function suspenseBoundaries(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(suspenseBoundaries);
  if (node.type === Suspense) return [node];
  return suspenseBoundaries(node.props?.children);
}

describe("Home workspace", () => {
  // #1469: between launch and first delivery Home says Meta is checking, once.
  const CHECKING = "Meta checks your ads first. This usually takes a few hours, sometimes up to a day.";
  it("says Meta is checking while the newest campaign's ads are in review (#1469)", () => {
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "1" } as unknown as Campaign;
    render(<WorkspaceHome {...empty} business={business} campaigns={[live]} adReview={{ kind: "checking", campaignId: "c-new" }} />);
    expect(screen.getByRole("status", { name: "Meta review" })).toHaveTextContent(CHECKING);
  });

  it("doesn't repeat it when the results verdict already says Meta is checking (#1469)", () => {
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "1", launched_at: new Date().toISOString() } as unknown as Campaign;
    const result = { campaign_id: "c-new", impressions: 0, clicks: 0, spend: 0, leads: 0, conversations: 0, fetched_at: new Date().toISOString(), raw: {} } as unknown as CampaignResult;
    render(<WorkspaceHome {...empty} business={business} campaigns={[live]} results={{ "c-new": result }} adReview={{ kind: "checking", campaignId: "c-new" }} />);
    expect(screen.getAllByText(/Meta checks your ads first/)).toHaveLength(1);
    expect(screen.queryByRole("status", { name: "Meta review" })).toBeNull();
  });

  it("shows the rejected-ads section in place of the checking line (#1469)", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[wentLive]} adReview={{ kind: "rejected", campaignId: "c-live" }}
      rejectedAds={<p>Meta didn&apos;t approve your ad.</p>} />);
    expect(screen.getByText("Meta didn't approve your ad.")).toBeInTheDocument();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  // #1150: Home lists only campaigns still in Meta, with the Campaigns page's status word.
  it("leaves campaigns deleted in Meta off Home's list", () => {
    const run = (id: string, status: string, raw: object = {}) => ({ id, name: `Run ${id}`, status, daily_budget: 300, raw }) as unknown as Campaign;
    render(<WorkspaceHome {...empty} business={business} campaigns={[run("old-1", "completed", { metaStatus: "DELETED" }), run("old-2", "completed", { metaStatus: "DELETED" }), run("live", "active")]} />);
    const list = screen.getByRole("heading", { name: "Campaigns" }).closest("section")!;
    expect(within(list).getByRole("link", { name: "Run live" })).toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: /Run old/ })).toBeNull();
    expect(within(list).getByText("Running")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "See all 3" })).toBeInTheDocument();
  });

  it("#1600 (Designer #1633): a campaign deleted in Meta keeps its Home row for a week, the CPO's line as its status (EN and HI)", () => {
    const now = Date.parse("2026-10-28T18:00:00Z");
    const run = (id: string, at: string) => ({ id, name: `Run ${id}`, status: "completed", daily_budget: 300, raw: { metaStatus: "DELETED", metaGoneAt: at } }) as unknown as Campaign;
    const campaigns = [run("fresh", "2026-10-27T18:00:00Z"), run("old", "2026-10-10T18:00:00Z")];
    const { unmount } = render(<WorkspaceHome {...empty} business={business} now={now} campaigns={campaigns} />);
    const list = screen.getByRole("heading", { name: "Campaigns" }).closest("section")!;
    const row = within(list).getByRole("link", { name: "Run fresh" }).closest("li")!;
    expect(within(row).getByText("Deleted in Meta. Run it again from Campaigns if you still want it.")).toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: "Run old" })).toBeNull();
    unmount();
    render(<WorkspaceHome {...empty} business={business} now={now} campaigns={campaigns} locale="hi" />);
    expect(screen.getByText("Meta में डिलीट हुआ है। अगर अब भी चाहिए, तो Campaigns से फिर से चलाएँ।")).toBeInTheDocument();
  });

  it("#1903 (CPO #1601): paused in Meta takes the status line; a budget raised in Meta shows for a week, a lower one stays on Campaigns (EN and HI)", () => {
    const now = Date.parse("2026-10-29T18:00:00Z");
    const run = (id: string, daily: number, raw: object) => ({ id, name: `Run ${id}`, status: "active", daily_budget: daily, raw }) as unknown as Campaign;
    const change = (was: number, then: number, at: string) => ({ metaBudgetChange: { wasRupees: was, nowRupees: then, at } });
    const campaigns = [
      run("paused", 300, { metaPausedAt: "2026-10-29T08:00:00Z" }),
      run("raised", 800, change(500, 800, "2026-10-29T08:00:00Z")),
      run("lowered", 300, change(500, 300, "2026-10-29T08:00:00Z")),
    ];
    const { unmount } = render(<WorkspaceHome {...empty} business={business} now={now} campaigns={campaigns} />);
    const list = screen.getByRole("heading", { name: "Campaigns" }).closest("section")!;
    const row = (name: string) => within(list).getByRole("link", { name }).closest("li")!;
    expect(within(row("Run paused")).getByText("Paused in Meta. Nothing is spending.")).toBeInTheDocument();
    const raised = within(row("Run raised")).getByText("The daily budget was changed in Meta Ads Manager: now ₹800 a day (was ₹500).");
    expect(raised.className).toContain("border-warning");
    expect(within(row("Run lowered")).queryByText(/changed in Meta Ads Manager/)).toBeNull();
    unmount();
    const week = render(<WorkspaceHome {...empty} business={business} now={now} campaigns={[run("raised-old", 800, change(500, 800, "2026-10-21T08:00:00Z"))]} />);
    expect(screen.getByRole("link", { name: "Run raised-old" })).toBeInTheDocument();
    expect(screen.queryByText(/changed in Meta Ads Manager/)).toBeNull();
    week.unmount();
    render(<WorkspaceHome {...empty} business={business} now={now} campaigns={campaigns} locale="hi" />);
    expect(screen.getByText("Meta में रोका गया है। कोई खर्च नहीं हो रहा।")).toBeInTheDocument();
    expect(screen.getByText("रोज़ का बजट Meta Ads Manager में बदला गया: अब ₹800 रोज़ (पहले ₹500)।")).toBeInTheDocument();
  });

  it("#1393: the workspace shell opens the Storage connection before the page streams in", async () => {
    queries.getUser.mockReturnValue(new Promise(() => {}));
    const { default: AppLayout } = await import("@/app/(app)/layout");
    const html = renderToString(<AppLayout><span>Private workspace</span></AppLayout>);
    expect(html).toContain('<link rel="preconnect" href="https://project.supabase.co"/>');
    expect(html).toContain("Loading workspace");
  });

  it("shows workspace loading while auth is pending and gates the shell on user and business", async () => {
    let resolveAuth!: (value: { id: string; email: string }) => void;
    let resolveBusiness!: (value: Business) => void;
    queries.getUser.mockReturnValue(new Promise(resolve => { resolveAuth = resolve; }));
    queries.getPrimaryBusiness.mockReturnValue(new Promise(resolve => { resolveBusiness = resolve; }));
    const { default: AppLayout } = await import("@/app/(app)/layout");
    const layout = AppLayout({ children: <span>Private workspace</span> });

    expect(layout.type).toBe(Suspense);
    render(layout.props.fallback);
    expect(screen.getByRole("status", { name: "Loading workspace" })).toBeInTheDocument();
    expect(renderToString(layout)).toContain("Loading workspace");
    const pendingShell = layout.props.children.type(layout.props.children.props);
    expect(queries.getPrimaryBusiness).not.toHaveBeenCalled();

    resolveAuth({ id: "owner", email: "owner@example.test" });
    await vi.waitFor(() => expect(queries.getPrimaryBusiness).toHaveBeenCalled());
    resolveBusiness(business);
    const shell = await pendingShell;
    expect(shell.props.email).toBe("owner@example.test");
    expect(shell.props.businessName).toBe(business.name);
  });

  it("does not read a business or render the shell when auth fails", async () => {
    queries.getUser.mockResolvedValue(null);
    queries.getPrimaryBusiness.mockReset();
    const { default: AppLayout } = await import("@/app/(app)/layout");
    const layout = AppLayout({ children: <span>Private workspace</span> });

    await expect(layout.props.children.type(layout.props.children.props)).rejects.toThrow("NEXT_REDIRECT");
    expect(queries.getPrimaryBusiness).not.toHaveBeenCalled();
  });

  it("streams connection settings independently of slow spend evaluation", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    let resolveSpend!: (value: object) => void;
    queries.getSpendEvaluation.mockReturnValue(new Promise(resolve => { resolveSpend = resolve; }));
    const { default: SettingsPage } = await import("@/app/(app)/settings/page");
    const page = await SettingsPage({ searchParams: Promise.resolve({}) });
    const boundaries = suspenseBoundaries(page);
    const boundary = (name: string) => boundaries.find((child: { props: { children: { type: { name: string } } } }) => child.props.children.type.name === name);
    const connectionBoundary = boundary("ConnectionSettings");
    const spendBoundary = boundary("SpendSettings");
    expect(connectionBoundary.type).toBe(Suspense);
    expect(spendBoundary.type).toBe(Suspense);
    // #235: the WhatsApp status streams in its own boundary; #847 places it with the Meta connection, above Billing.
    const whatsapp = connectionBoundary.props.children.props.whatsapp;
    expect(whatsapp.type).toBe(Suspense);
    expect(whatsapp.props.children.type.name).toBe("WhatsAppStatusSection");
    // #238: preferences and privacy requests load in their own server-rendered boundary.
    const privacyBoundary = boundaries.at(-1);
    expect(privacyBoundary.type).toBe(Suspense);
    expect(privacyBoundary.props.children.type.name).toBe("PreferenceAndPrivacySettings");
    const spendSection = spendBoundary.props.children;
    const spend = spendSection.type(spendSection.props);
    const connectionSection = connectionBoundary.props.children;
    render(await connectionSection.type({ ...connectionSection.props, whatsapp: null }));
    expect(screen.getByText("Connection loaded")).toBeInTheDocument();
    resolveSpend({ limits: {}, evaluation: {} });
    render(await spend);
    expect(screen.getByText("Guardrails loaded")).toBeInTheDocument();
  });

  it("keeps privacy requests available before a business is set up", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(null);
    const { default: SettingsPage } = await import("@/app/(app)/settings/page");
    const page = await SettingsPage({ searchParams: Promise.resolve({}) });
    expect(page.props.children.at(-1).props.children.type.name).toBe("PrivacyRequests");
  });

  it("keeps spend failures local instead of replacing settings or showing editable defaults", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getSpendEvaluation.mockRejectedValue(new Error("Unavailable"));
    const { default: SettingsPage } = await import("@/app/(app)/settings/page");
    const page = await SettingsPage({ searchParams: Promise.resolve({}) });
    const section = suspenseBoundaries(page).find((child: { props: { children: { type: { name: string } } } }) =>
      child.props.children.type.name === "SpendSettings").props.children;
    render(await section.type(section.props));
    expect(screen.getByRole("alert")).toHaveTextContent("Your saved limits have not changed.");
    expect(screen.queryByText("Guardrails loaded")).not.toBeInTheDocument();
  });

  it("starts campaign results before unrelated creatives and connection reads finish", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCampaignPage.mockResolvedValue({ campaigns: [{ id: "campaign-1" }], nextCursor: null });
    queries.getLatestResultsWithEnquiries.mockResolvedValue({});
    let resolveApproved!: (value: Creative[]) => void;
    let resolveConnection!: (value: { ready: boolean }) => void;
    queries.getApprovedCreatives.mockReturnValue(new Promise<Creative[]>((resolve) => { resolveApproved = resolve; }));
    queries.getMetaConnection.mockReturnValue(new Promise<{ ready: boolean }>((resolve) => { resolveConnection = resolve; }));
    const { default: CampaignsPage } = await import("@/app/(app)/campaigns/page");
    const page = CampaignsPage({ searchParams: Promise.resolve({}) });
    await vi.waitFor(() => expect(queries.getLatestResultsWithEnquiries).toHaveBeenCalledWith(["campaign-1"]));
    resolveApproved([]);
    resolveConnection({ ready: false });
    render(await page);
    expect(screen.getByText("Campaigns loaded")).toBeInTheDocument();
  });

  it("loads Studio without waiting for the operator's concurrent usage report", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getUser.mockResolvedValue({ email: "demo@example.test" });
    let resolveUsage!: (value: object) => void;
    const usage = new Promise<object>((resolve) => { resolveUsage = resolve; });
    queries.businessLLMUsageSummary.mockReturnValue(usage);
    let resolveCreatives!: (value: Creative[]) => void;
    queries.getCreatives.mockReturnValue(new Promise<Creative[]>((resolve) => { resolveCreatives = resolve; }));
    const { default: StudioPage } = await import("@/app/(app)/studio/page");
    const page = StudioPage({ searchParams: Promise.resolve({}) });
    await vi.waitFor(() => expect(queries.businessLLMUsageSummary).toHaveBeenCalledWith(business.id));
    expect(queries.getCreatives).toHaveBeenCalledWith(business.id);
    resolveCreatives([]);
    const content = (await page).props.children[1];
    render(content.props.children[0]);
    expect(screen.getByText("Studio loaded")).toBeInTheDocument();
    const boundary = content.props.children[1];
    expect(boundary.type).toBe(Suspense);
    expect(boundary.props.fallback).toBeNull();
    const report = boundary.props.children;
    resolveUsage({});
    render(await report.type(report.props));
    expect(screen.getByText("Usage loaded")).toBeInTheDocument();
  });

  it("never starts the usage report for an owner who isn't an operator (#403)", async () => {
    operator.allowed = false;
    try {
      queries.getPrimaryBusiness.mockResolvedValue(business);
      queries.getUser.mockResolvedValue({ email: "owner@example.test" });
      queries.getCreatives.mockResolvedValue([]);
      const { default: StudioPage } = await import("@/app/(app)/studio/page");
      const content = (await StudioPage({ searchParams: Promise.resolve({}) })).props.children[1];
      expect(content.props.children[1]).toBeFalsy();
      expect(queries.businessLLMUsageSummary).not.toHaveBeenCalled();
    } finally {
      operator.allowed = true;
    }
  });

  it("shows a first-run action without fabricated metrics", () => {
    render(<WorkspaceHome {...empty} />);
    expect(
      screen.getByRole("link", { name: "Set up your business" }),
    ).toHaveAttribute("href", "/brand");
    expect(screen.queryByText("Active campaigns")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("links directly to the pending review and selected creative", () => {
    const { container } = render(
      <WorkspaceHome {...empty} business={business} creatives={[creative]} />,
    );
    expect(screen.getByRole("link", { name: "Review ads" })).toHaveAttribute(
      "href",
      "/studio?status=draft",
    );
    expect(
      screen.getByRole("link", { name: /A home worth caring for/ }),
    ).toHaveAttribute("href", "/studio?creative=draft-1");
    expect(container.querySelector("a button")).toBeNull();
  });

  it("shows the small saved thumbnail instead of the full image", () => {
    const base = "https://example.supabase.co/storage/v1/object/public/creatives/biz-1/group-1";
    render(<WorkspaceHome {...empty} business={business} creatives={[{ ...creative, image_url: `${base}/originals-v1/value-ad-1.png` }]} />);
    expect(screen.getByRole("img", { name: creative.headline! })).toHaveAttribute("src", `${base}/thumbnails-v1/value-ad-1.webp`);
  });

  it("loads independent dashboard reads concurrently", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getApprovedCreatives.mockClear();
    let resolveCreatives!: (value: Creative[]) => void;
    queries.getCreativePreviews.mockReturnValue(
      new Promise<Creative[]>((resolve) => {
        resolveCreatives = resolve;
      }),
    );
    queries.getAuditLog.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([wentLive]);
    queries.getSpendEvaluation.mockResolvedValue({ limits: {}, evaluation: { status: "healthy" } });
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    const { default: DashboardPage } =
      await import("@/app/(app)/dashboard/page");
    const page = DashboardPage();
    await vi.waitFor(() =>
      expect(queries.getMetaConnection).toHaveBeenCalledWith(business.id),
    );
    expect(queries.getCampaigns).toHaveBeenCalledWith(business.id);
    resolveCreatives([creative]);
    render(await page);
    expect(queries.getApprovedCreatives).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "1 ad needs review" }),
    ).toBeInTheDocument();
  });

  it("renders the dashboard before the recent activity read finishes", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([creative]);
    queries.getCampaigns.mockResolvedValue([wentLive]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    let resolveAudit!: (value: object[]) => void;
    queries.getAuditLog.mockReturnValue(new Promise(resolve => { resolveAudit = resolve; }));

    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const page = DashboardPage();
    const ready = await Promise.race([page.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 75))]);
    expect(ready).toBe(true);
    const content = await page;
    expect(content.props.activity.type).toBe(Suspense);
    render(<WorkspaceHome {...content.props} spendStatus={null} activity={content.props.activity.props.fallback} />);
    expect(screen.getByRole("heading", { name: "1 ad needs review" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading recent activity");
    resolveAudit([]);
    const feed = content.props.activity.props.children;
    const activity = await feed.type(feed.props);
    expect(activity.type(activity.props)).toBeNull();
  });

  it("a first-timer's Home is the one resume card at the saved step (#1272)", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getApprovedCreatives.mockClear();
    queries.getCreativePreviews.mockResolvedValue([creative]);
    queries.getCampaigns.mockResolvedValue([]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockResolvedValue([]);
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    render(await DashboardPage());
    // The test business has no phone or offers yet, so it resumes at step 1.
    expect(screen.getByRole("heading", { name: "Your first ad" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3 · Your business")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/brand");
    expect(queries.getApprovedCreatives).not.toHaveBeenCalled();
  });

  describe("the first-timer Home and Go live agree on ready ads (#2371)", () => {
    const setupBusiness = { ...business, name: "SunPeak", vertical: "Rooftop solar", phone: "9876543210", offers: ["Free survey"] };
    const currentGoal = "Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free survey";
    const approved = (id: string, facts: string[]) => ({
      ...creative, id, status: "approved", headline: `Ad ${id}`,
      image_url: `https://example.supabase.co/storage/v1/object/public/creatives/${id}.png`,
      generation: { sourceFacts: facts },
    });

    function arrange() {
      queries.getPrimaryBusiness.mockResolvedValue(setupBusiness);
      queries.getCreativePreviews.mockResolvedValue([]);
      queries.getCampaigns.mockResolvedValue([]);
      queries.getMetaConnection.mockResolvedValue({ ready: false });
      queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
      queries.getAuditLog.mockResolvedValue([]);
      queries.getApprovedCreatives.mockResolvedValue([]);
    }

    it.each([
      ["older details", ["Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free quote"]],
      ["Studio", []],
    ])("an approved ad from %s shows step 2 and links directly to Create", async (_source, facts) => {
      arrange();
      const old = approved("old", facts);
      queries.getCreativePreviews.mockResolvedValue([old]);
      queries.getApprovedCreatives.mockResolvedValue([old]);
      const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
      render(await DashboardPage());
      expect(queries.getApprovedCreatives).toHaveBeenCalledWith(setupBusiness.id, { throwOnError: true });
      expect(screen.getByText("Step 2 of 3 · Your ads")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/create");
    });

    it("shows step 2 when no ads have been approved", async () => {
      arrange();
      const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
      render(await DashboardPage());
      expect(screen.getByText("Step 2 of 3 · Your ads")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/create");
    });

    it("uses only current ads for both the step and ready card, even if previews are empty", async () => {
      arrange();
      queries.getApprovedCreatives.mockResolvedValue([
        approved("old", ["Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free quote"]),
        approved("current", [currentGoal]),
      ]);
      const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
      render(await DashboardPage());
      expect(screen.getByRole("heading", { name: "Your ad is ready" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Ad current" })).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Ad old" })).toBeNull();
      expect(screen.getByRole("link", { name: "Connect and go live" })).toHaveAttribute("href", "/campaigns");
    });

    it("reports an unreadable approved-ad list instead of guessing the step", async () => {
      arrange();
      queries.getCreativePreviews.mockResolvedValue([approved("current", [currentGoal])]);
      queries.getApprovedCreatives.mockRejectedValueOnce(new Error("database down"));
      const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
      render(await DashboardPage());
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn't check on your ads just now");
      expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/dashboard");
      expect(screen.queryByText(/Step [123] of 3/)).toBeNull();
    });
  });

  // #1670 (CTO): a new owner with a prepared business waiting is asked first, before WS1 would start an empty one.
  it("a signed-in owner with no business and a pending hand-over is asked 'Make … yours?' first (#1670)", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(null);
    transfer.myPendingTransfer.mockResolvedValueOnce({ transferId: "11111111-1111-4111-8111-111111111111", businessName: "Nook and Grain", ads: 3, images: [] });
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Make Nook and Grain yours?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your first ad" })).toBeNull();
  });

  it("after Make it mine, Home says it's theirs above the first-ad card (#1670)", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([creative]);
    queries.getCampaigns.mockResolvedValue([]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockResolvedValue([]);
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    render(await DashboardPage({ searchParams: Promise.resolve({ handed: "1" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("It's yours. The 'Sample' mark is off your ads. Nothing runs until you tap Go live.");
    expect(transfer.myPendingTransfer).not.toHaveBeenCalled();
  });

  it("reads the newest live campaign's stored ad statuses for the Meta review line (#1469)", async () => {
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "123", launched_at: "2026-10-28T10:00:00Z", created_at: "2026-10-28T10:00:00Z" } as unknown as Campaign;
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([live, wentLive]);
    queries.getMetaConnection.mockResolvedValue({ ready: true });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockResolvedValue([]);
    queries.getLatestResultsWithEnquiries.mockResolvedValue({});
    queries.getAdStatuses.mockResolvedValue(["PENDING_REVIEW", "IN_PROCESS"]);
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    render(await DashboardPage());
    expect(queries.getAdStatuses).toHaveBeenCalledWith("c-new");
    expect(screen.getByRole("status", { name: "Meta review" })).toHaveTextContent(CHECKING);
    vi.unstubAllEnvs();
  });

  it("asks the day-7 pricing question once the first week has passed, and not for an exempt business (#1650)", async () => {
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "123", launched_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z" } as unknown as Campaign;
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([live]);
    queries.getMetaConnection.mockResolvedValue({ ready: true });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockResolvedValue([]);
    queries.getLatestResultsWithEnquiries.mockResolvedValue({});
    pilot.facts.mockResolvedValueOnce({ exempt: false, firstLaunchAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), events: [] });
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const { unmount } = render(await DashboardPage());
    expect(screen.getByText(/would you pay ₹999 a month/)).toBeInTheDocument();
    unmount();
    render(await DashboardPage());
    expect(screen.queryByText(/would you pay ₹999 a month/)).toBeNull();
  });

  it("offers the weekly results card only in a week it's offered (#2036)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "123", launched_at: "2026-10-01T10:00:00Z", created_at: "2026-10-01T10:00:00Z" } as unknown as Campaign;
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([live]);
    queries.getMetaConnection.mockResolvedValue({ ready: true });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockResolvedValue([]);
    queries.getLatestResultsWithEnquiries.mockResolvedValue({});
    card.facts.mockResolvedValueOnce({ offered: true, enquiries: 6, area: "Sector 70" });
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const { unmount } = render(await DashboardPage());
    expect(screen.getByRole("region", { name: "Good week. Share it?" })).toHaveTextContent("6 people enquired this week.");
    unmount();
    render(await DashboardPage());
    expect(screen.queryByText("Good week. Share it?")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps recent activity failures local to their section", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([wentLive]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    queries.getSpendEvaluation.mockResolvedValue({ evaluation: { status: "healthy" } });
    queries.getAuditLog.mockRejectedValue(new Error("Private audit detail"));

    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const page = await DashboardPage();
    const feed = page.props.activity.props.children;
    render(await feed.type(feed.props));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load your recent activity. Reload the page.");
    expect(screen.queryByText("Private audit detail")).not.toBeInTheDocument();
  });

  it("renders usable dashboard content while spend evaluation is pending", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([creative]);
    queries.getAuditLog.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([wentLive]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    const overCap = evaluateSpend(
      [{ id: "campaign", status: "active", dailyBudget: 100, spend: 0 }],
      { ...DEFAULT_SPEND_LIMITS, weeklyCapRupees: 500 },
    );
    let resolveSpend!: (value: { evaluation: typeof overCap }) => void;
    queries.getSpendEvaluation.mockReturnValue(new Promise(resolve => { resolveSpend = resolve; }));

    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const page = DashboardPage();
    await vi.waitFor(() => expect(queries.getSpendEvaluation).toHaveBeenCalledWith(business.id));
    const ready = await Promise.race([
      page.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 75)),
    ]);
    expect(ready).toBe(true);
    render(await page);
    expect(screen.getByRole("heading", { name: "1 ad needs review" })).toBeInTheDocument();
    expect(screen.getByText("Checking spend status...")).toBeInTheDocument();
    resolveSpend({ evaluation: overCap });
    const spendBoundary = (await page).props.spendStatus;
    const notice = spendBoundary.props.children;
    render(await notice.type(notice.props));
    expect(screen.getByRole("alert")).toHaveTextContent("weekly ad-spend cap");
  });

  it("reports an unavailable spend read without claiming a safe status", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getAuditLog.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([wentLive]);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    queries.getSpendEvaluation.mockRejectedValue(new Error("Private database detail"));

    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    const page = await DashboardPage();
    const notice = page.props.spendStatus.props.children;
    render(await notice.type(notice.props));
    expect(screen.getByRole("alert")).toHaveTextContent("Spend status could not be loaded");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText("Private database detail")).not.toBeInTheDocument();
  });
});

// #764: CPO's first-time-owner walk: Home showed work (75 awaiting review), not results. The first row now
// answers "is it working?" with the same latest results the campaign cards show.
describe("Home results row (#764)", () => {
  const now = Date.parse("2026-10-26T10:00:00Z");
  const chats = { id: "c-wa", business_id: "business", name: "WhatsApp run", status: "active", destination: "whatsapp", meta_campaign_id: "1", created_at: "2026-10-24T08:00:00Z" } as unknown as Campaign;
  const forms = { id: "c-form", business_id: "business", name: "Form run", status: "paused", destination: "instant_form", meta_campaign_id: "2", created_at: "2026-10-22T08:00:00Z" } as unknown as Campaign;
  const results = {
    "c-wa": { id: "r1", campaign_id: "c-wa", destination: "whatsapp", impressions: 900, clicks: 40, leads: 0, conversations: 5, spend: 840, cpl: null, fetched_at: new Date(now - 3 * 60_000).toISOString() },
    "c-form": { id: "r2", campaign_id: "c-form", destination: "instant_form", impressions: 300, clicks: 9, leads: 2, spend: 160, cpl: 80, fetched_at: new Date(now - 10 * 60_000).toISOString() },
  } as unknown as Record<string, CampaignResult>;

  it("sums enquiries and spend from each campaign's latest results and says how fresh they are", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} />);
    const row = screen.getByRole("region", { name: "Results so far" });
    expect(within(row).getByText("Enquiries").nextElementSibling).toHaveTextContent("7");
    expect(within(row).getByText("Spent").nextElementSibling).toHaveTextContent("₹1,000");
    expect(within(row).getByText("Per enquiry").nextElementSibling).toHaveTextContent("₹143");
    expect(within(row).getByText(/Updated 10m ago/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /See campaigns/ })).toHaveAttribute("href", "/campaigns");
  });

  it("#1838: while Meta asks us to wait, says the numbers may be old (Hindi too); after it clears, no line", () => {
    const later = new Date(now + 30 * 60_000).toISOString();
    const { unmount } = render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} metaWaitUntil={later} />);
    expect(screen.getByText("Meta is limiting how often we can check right now, so these numbers may be up to about 10 minutes old. Your ads keep running, and pausing still works.")).toBeInTheDocument();
    unmount();
    const hindi = render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} metaWaitUntil={later} locale="hi" />);
    expect(screen.getByText(/लगभग 10 मिनट तक पुराने हो सकते हैं/)).toBeInTheDocument();
    hindi.unmount();
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} metaWaitUntil={new Date(now - 60_000).toISOString()} />);
    expect(screen.queryByText(/Meta is limiting/)).toBeNull();
  });

  it("#1934: a launched owner starts a new campaign from Home in the guided returning mode", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} />);
    expect(within(screen.getByRole("region", { name: "Results so far" })).getByRole("link", { name: "New campaign" })).toHaveAttribute("href", "/brand?again=1");
  });

  // #1774 (QA): in Hindi the freshness line was the one English phrase left in the row.
  it("#1774: in Hindi, says how fresh in Hindi; English keeps '10m ago'", () => {
    const old = { ...results, "c-form": { ...results["c-form"], fetched_at: new Date(now - 2 * 86_400_000).toISOString() } } as Record<string, CampaignResult>;
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={old} now={now} locale="hi" />);
    const row = screen.getByRole("region", { name: "अब तक के नतीजे" });
    expect(within(row).getByText(/2 दिन पहले अपडेट हुआ/)).toBeInTheDocument();
    expect(within(row).queryByText(/Updated|ago/)).toBeNull();
  });

  it("#1049: says how fast the owner replies to enquiries, when there's a reply to measure", () => {
    const { rerender } = render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} replyMinutes={12.4} now={now} />);
    expect(screen.getByText(/You usually contact people within/)).toHaveTextContent("You usually contact people within 12 min (last 30 days).");
    rerender(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} replyMinutes={null} now={now} />);
    expect(screen.queryByText(/You usually contact people within/)).not.toBeInTheDocument();
  });

  // #1274 slice 2b: Home leads with the best running campaign's verdict, people waiting first; each row gets its word.
  it("#1274: leads with the running campaign's verdict sentence and labels each campaign", () => {
    const { rerender } = render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} />);
    const row = screen.getByRole("region", { name: "Results so far" });
    const lead = within(row).getByRole("link", { name: "WhatsApp run" }).closest("p");
    expect(lead).toHaveTextContent("Each chat costs ₹168. WhatsApp run");
    const campaignsList = screen.getByRole("region", { name: "Campaigns" });
    // #1795: 'Live' and 'Ended' only restate the status, so the row shows no word ('Paused · Live' contradicted it).
    expect(within(campaignsList).queryByText("Live")).not.toBeInTheDocument();
    rerender(<WorkspaceHome {...empty} business={business} campaigns={[{ ...chats, status: "completed" } as Campaign, forms]} results={results} now={now} />);
    expect(within(screen.getByRole("region", { name: "Campaigns" })).getAllByText("Ended")).toHaveLength(1);
    rerender(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} waiting={2} now={now} />);
    expect(within(screen.getByRole("region", { name: "Results so far" })).getByRole("link", { name: "WhatsApp run" }).closest("p")).toHaveTextContent(/^2 people are waiting for your reply\. /);
    // With #1292's named line on Home, the count isn't repeated.
    rerender(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} waiting={2} firstEnquiry={{ name: "Rohit", at: "2026-10-26T04:10:00Z" }} now={now} />);
    expect(within(screen.getByRole("region", { name: "Results so far" })).getByRole("link", { name: "WhatsApp run" }).closest("p")).toHaveTextContent("Each chat costs ₹168. WhatsApp run");
  });

  // #1438: in Hindi, Home's lead sentence and the row words come from the same Hindi verdicts.
  it("#1438: the verdict sentence and row words in Hindi", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats, forms]} results={results} now={now} locale="hi" />);
    const row = screen.getByRole("region", { name: "अब तक के नतीजे" });
    expect(within(row).getByRole("link", { name: "WhatsApp run" }).closest("p")).toHaveTextContent("हर चैट ₹168 की पड़ रही है। WhatsApp run");
    expect(screen.queryByText(/Each chat costs|Early days/)).toBeNull();
  });

  it("#1274: no lead sentence when nothing is running", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[{ ...chats, status: "paused" } as Campaign, forms]} results={results} now={now} />);
    expect(within(screen.getByRole("region", { name: "Results so far" })).queryByRole("link", { name: "WhatsApp run" })).not.toBeInTheDocument();
  });

  it("#1292: names the newest unanswered enquiry and when they tapped the ad (CPO's words)", () => {
    const { rerender } = render(<WorkspaceHome {...empty} business={business} firstEnquiry={{ name: "Rohit", at: "2026-10-26T04:10:00Z" }} now={now} />);
    const line = screen.getByRole("region", { name: "Newest enquiry" });
    expect(line).toHaveTextContent("Rohit tapped your ad at 9:40 am. Reply now; people often go with the first business that answers.");
    expect(within(line).getByRole("link", { name: "Open Enquiries" })).toHaveAttribute("href", "/leads");
    rerender(<WorkspaceHome {...empty} business={business} firstEnquiry={null} now={now} />);
    expect(screen.queryByRole("region", { name: "Newest enquiry" })).not.toBeInTheDocument();
  });

  it("shows no results row before any campaign has results", () => {
    render(<WorkspaceHome {...empty} business={business} campaigns={[chats]} results={{}} now={now} />);
    expect(screen.queryByRole("region", { name: "Results so far" })).not.toBeInTheDocument();
  });

  it("the dashboard reads the launched campaigns' latest results", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCreativePreviews.mockResolvedValue([]);
    queries.getAuditLog.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([chats, forms, { ...forms, id: "c-draft", meta_campaign_id: null }]);
    queries.getLatestResultsWithEnquiries.mockResolvedValue(results);
    queries.getSpendEvaluation.mockResolvedValue({ limits: {}, evaluation: { status: "healthy" } });
    queries.getMetaConnection.mockResolvedValue({ ready: true });
    const { default: DashboardPage } = await import("@/app/(app)/dashboard/page");
    render(await DashboardPage());
    expect(queries.getLatestResultsWithEnquiries).toHaveBeenCalledWith(["c-wa", "c-form"]);
    expect(screen.getByRole("region", { name: "Results so far" })).toBeInTheDocument();
  });
});

// #763: background syncs are a system log, not something the owner did.
describe("Recent activity", () => {
  const row = (id: string, action: string, reason: string | null = null) =>
    ({ id, action, reason, authority: "server", created_at: "2026-10-20T10:00:00Z" }) as Parameters<typeof RecentActivity>[0]["audit"][number];

  it("leaves out enquiry and campaign syncs", () => {
    render(<RecentActivity audit={[row("1", "leads.sync", "Imported 0 new lead(s); 0 form(s) failed"), row("2", "campaign.pause"), row("3", "campaigns.sync")]} />);
    expect(screen.getByText("Campaign paused")).toBeInTheDocument();
    expect(screen.queryByText(/lead\(s\)|from Meta/)).not.toBeInTheDocument();
  });

  it("shows nothing when only syncs happened", () => {
    const { container } = render(<RecentActivity audit={[row("1", "leads.sync")]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("#1968: Pause all ads on Home", () => {
  it("shows the quiet stop while a campaign runs, and not otherwise", () => {
    const live = { id: "c-new", name: "Solar", status: "active", daily_budget: 300, raw: {}, meta_campaign_id: "1" } as unknown as Campaign;
    const { unmount } = render(<WorkspaceHome {...empty} business={business} campaigns={[live]} />);
    expect(screen.getByRole("button", { name: "Pause all ads" })).toBeInTheDocument();
    unmount();
    render(<WorkspaceHome {...empty} business={business} campaigns={[{ ...live, status: "paused" } as Campaign]} />);
    expect(screen.queryByRole("button", { name: "Pause all ads" })).toBeNull();
  });
});
