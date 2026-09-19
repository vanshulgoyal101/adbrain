// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHome } from "@/components/workspace-home";
import type { Business, Creative } from "@/lib/types";

const queries = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  getCreatives: vi.fn(),
  getCreativePreviews: vi.fn(),
  getAuditLog: vi.fn(),
  getCampaigns: vi.fn(),
  getCampaignPage: vi.fn(),
  getApprovedCreatives: vi.fn(),
  getLatestResults: vi.fn(),
  getSpendEvaluation: vi.fn(),
  getMetaConnection: vi.fn(),
  getUser: vi.fn(),
  businessLLMUsageSummary: vi.fn(),
}));
vi.mock("@/lib/supabase/queries", () => queries);
vi.mock("@/lib/llm/persist", () => ({ businessLLMUsageSummary: queries.businessLLMUsageSummary }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ DEMO_USER_EMAIL: "demo@example.test" }) }));
vi.mock("@/components/studio", () => ({ Studio: () => <div>Studio loaded</div> }));
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

describe("Home workspace", () => {
  it("streams connection settings independently of slow spend evaluation", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getMetaConnection.mockResolvedValue({ ready: false });
    let resolveSpend!: (value: object) => void;
    queries.getSpendEvaluation.mockReturnValue(new Promise(resolve => { resolveSpend = resolve; }));
    const { default: SettingsPage } = await import("@/app/(app)/settings/page");
    const page = await SettingsPage({ searchParams: Promise.resolve({}) });
    const [, connectionBoundary, spendBoundary] = page.props.children;
    expect(connectionBoundary.type).toBe(Suspense);
    expect(spendBoundary.type).toBe(Suspense);
    const spendSection = spendBoundary.props.children;
    const spend = spendSection.type(spendSection.props);
    const connectionSection = connectionBoundary.props.children;
    render(await connectionSection.type(connectionSection.props));
    expect(screen.getByText("Connection loaded")).toBeInTheDocument();
    resolveSpend({ limits: {}, evaluation: {} });
    render(await spend);
    expect(screen.getByText("Guardrails loaded")).toBeInTheDocument();
  });

  it("keeps spend failures local instead of replacing settings or showing editable defaults", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getSpendEvaluation.mockRejectedValue(new Error("Unavailable"));
    const { default: SettingsPage } = await import("@/app/(app)/settings/page");
    const page = await SettingsPage({ searchParams: Promise.resolve({}) });
    const section = page.props.children[2].props.children;
    render(await section.type(section.props));
    expect(screen.getByRole("alert")).toHaveTextContent("Your saved limits have not changed.");
    expect(screen.queryByText("Guardrails loaded")).not.toBeInTheDocument();
  });

  it("starts campaign results before unrelated creatives and connection reads finish", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    queries.getCampaignPage.mockResolvedValue({ campaigns: [{ id: "campaign-1" }], nextCursor: null });
    queries.getLatestResults.mockResolvedValue({});
    let resolveApproved!: (value: Creative[]) => void;
    let resolveConnection!: (value: { ready: boolean }) => void;
    queries.getApprovedCreatives.mockReturnValue(new Promise<Creative[]>((resolve) => { resolveApproved = resolve; }));
    queries.getMetaConnection.mockReturnValue(new Promise<{ ready: boolean }>((resolve) => { resolveConnection = resolve; }));
    const { default: CampaignsPage } = await import("@/app/(app)/campaigns/page");
    const page = CampaignsPage();
    await vi.waitFor(() => expect(queries.getLatestResults).toHaveBeenCalledWith(["campaign-1"]));
    resolveApproved([]);
    resolveConnection({ ready: false });
    render(await page);
    expect(screen.getByText("Campaigns loaded")).toBeInTheDocument();
  });

  it("loads Studio without waiting for the concurrent demo usage report", async () => {
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
    expect(report.props.usage).toBe(usage);
    resolveUsage({});
    render(await report.type(report.props));
    expect(screen.getByText("Usage loaded")).toBeInTheDocument();
  });

  it("shows a first-run action without fabricated metrics", () => {
    render(<WorkspaceHome {...empty} />);
    expect(
      screen.getByRole("link", { name: "Set up Brand Brain" }),
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
    expect(screen.getByText("Not added")).toBeInTheDocument();
    expect(container.querySelector("a button")).toBeNull();
  });

  it("loads independent dashboard reads concurrently", async () => {
    queries.getPrimaryBusiness.mockResolvedValue(business);
    let resolveCreatives!: (value: Creative[]) => void;
    queries.getCreativePreviews.mockReturnValue(
      new Promise<Creative[]>((resolve) => {
        resolveCreatives = resolve;
      }),
    );
    queries.getAuditLog.mockResolvedValue([]);
    queries.getCampaigns.mockResolvedValue([]);
    queries.getSpendEvaluation.mockResolvedValue(null);
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
    expect(
      screen.getByRole("heading", { name: "1 ad needs review" }),
    ).toBeInTheDocument();
  });
});
