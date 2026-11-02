// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { homeCustomers, homeResults } from "@/lib/campaign/home-results";
import { WorkspaceHome } from "@/components/workspace-home";
import { PilotDay7Card } from "@/components/pilot-day7-card";
import type { Business, Campaign, CampaignResult } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// #2026 (#2020): cost per customer is the number owners care about; Home and the Day 7 card show it once one is marked.
const form = (id: string) => ({ id, name: id, status: "active", destination: "instant_form", daily_budget: 300, raw: {}, creative_ids: [], meta_campaign_id: "2" }) as unknown as Campaign;
const result = (campaign_id: string, extra: Partial<CampaignResult> = {}) =>
  ({ campaign_id, conversations: 0, leads: 4, spend: 1200, impressions: 900, clicks: 10, fetched_at: "2026-10-28T10:00:00Z", raw: {}, real_enquiries: 0, customers: 0, ...extra }) as unknown as CampaignResult;
const business = { id: "b", name: "Solar", vertical: "solar", locations: ["Mohali"], description: "x", target_audience: "y", brand_voice: "z" } as unknown as Business;
const home = (results: Record<string, CampaignResult>, locale: "en" | "hi" = "en") =>
  render(<WorkspaceHome business={business} creatives={[]} campaigns={Object.keys(results).map(form)} audit={[]} metaReady spend={null} results={results} locale={locale} />);

describe("Home: customers and ad spend per customer (#2026)", () => {
  it("sums the cards' customers: a line from 1, the ask at 0 with 3+ enquiries, nothing before that", () => {
    expect(homeCustomers(homeResults([form("a"), form("b")], { a: result("a", { customers: 1 }), b: result("b", { customers: 2 }) })))
      .toEqual({ kind: "line", customers: 3, perCustomer: 800 });
    expect(homeCustomers(homeResults([form("a")], { a: result("a", { leads: 3 }) }))).toEqual({ kind: "ask" });
    expect(homeCustomers(homeResults([form("a")], { a: result("a", { leads: 2 }) }))).toBeNull();
    // Home already asks which chats were real (#1624), so it doesn't ask twice.
    expect(homeCustomers(homeResults([form("a")], { a: result("a", { leads: 3 }) }), 5)).toBeNull();
    // Unreadable marked customers: neither line nor ask.
    expect(homeCustomers(homeResults([form("a")], { a: result("a", { customers: undefined }) }))).toBeNull();
  });

  it("shows the line under the numbers, in English and Hindi", () => {
    const { unmount } = home({ a: result("a", { customers: 1 }) });
    expect(screen.getByText("1 became a customer · ₹1,200 ad spend per customer")).toBeInTheDocument();
    unmount();
    const second = home({ a: result("a", { customers: 2 }) });
    expect(screen.getByText("2 became customers · ₹600 ad spend per customer")).toBeInTheDocument();
    second.unmount();
    home({ a: result("a", { customers: 2 }) }, "hi");
    expect(screen.getByText("2 ग्राहक बने · हर ग्राहक पर ₹600 ऐड खर्च")).toBeInTheDocument();
  });

  it("with none marked and 3+ enquiries asks, linking to Enquiries", () => {
    home({ a: result("a") });
    expect(screen.getByText(/Did any of these enquiries buy\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mark customers" })).toHaveAttribute("href", "/leads");
    expect(screen.queryByText(/ad spend per customer/)).toBeNull();
  });

  it("the Day 7 card shows the line above the ₹999 question, and nothing when none is marked", () => {
    const { unmount } = render(<PilotDay7Card businessId="11111111-1111-4111-8111-111111111111" customers={{ customers: 2, perCustomer: 600 }} />);
    const line = screen.getByText("2 became customers · ₹600 ad spend per customer");
    expect(line.compareDocumentPosition(screen.getByText(/would you pay ₹999 a month/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<PilotDay7Card businessId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.queryByText(/ad spend per customer|Mark customers/)).toBeNull();
  });
});
