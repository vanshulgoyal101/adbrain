// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHome } from "@/components/workspace-home";
import type { Business, Creative } from "@/lib/types";

const queries = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  getCreatives: vi.fn(),
  getAuditLog: vi.fn(),
  getCampaigns: vi.fn(),
  getSpendEvaluation: vi.fn(),
  getMetaConnection: vi.fn(),
}));
vi.mock("@/lib/supabase/queries", () => queries);
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
    queries.getCreatives.mockReturnValue(
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
