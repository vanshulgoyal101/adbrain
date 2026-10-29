// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { homeResults, unloggedChats } from "@/lib/campaign/home-results";
import { buildWorkQueue } from "@/lib/work-queue";
import { WorkspaceHome } from "@/components/workspace-home";
import type { Business, Campaign, CampaignResult } from "@/lib/types";

// #1624 (CPO, #1603): Home's numbers for WhatsApp campaigns are Meta's chats, not real enquiries; and Home asks the
// owner which chats were real, because ₹ per real enquiry and customers depend on it.
const chat = (id: string, status = "active") => ({ id, name: id, status, destination: "whatsapp", daily_budget: 300, raw: {}, creative_ids: [], meta_campaign_id: "1" }) as unknown as Campaign;
const form = (id: string) => ({ id, name: id, status: "active", destination: "instant_form", daily_budget: 300, raw: {}, creative_ids: [], meta_campaign_id: "2" }) as unknown as Campaign;
const result = (campaign_id: string, extra: Partial<CampaignResult> = {}) =>
  ({ campaign_id, conversations: 3, leads: 2, spend: 300, impressions: 900, clicks: 10, fetched_at: "2026-10-28T10:00:00Z", raw: {}, ...extra }) as unknown as CampaignResult;
const business = { id: "b", name: "Solar", vertical: "solar", locations: ["Mohali"], description: "x", target_audience: "y", brand_voice: "z" } as unknown as Business;

describe("Home: chats are chats (#1624)", () => {
  it("knows when every counted campaign is WhatsApp", () => {
    expect(homeResults([chat("a")], { a: result("a") })).toMatchObject({ enquiries: 3, chatsOnly: true });
    expect(homeResults([chat("a"), form("f")], { a: result("a"), f: result("f") })).toMatchObject({ chatsOnly: false });
    expect(homeResults([form("f")], { f: result("f") })).toMatchObject({ chatsOnly: false });
  });

  it("labels the row Chats · Spent · Per chat for WhatsApp-only, in English and Hindi", () => {
    const { unmount } = render(<WorkspaceHome business={business} creatives={[]} campaigns={[chat("a")]} audit={[]} metaReady spend={null} results={{ a: result("a") }} />);
    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.getByText("Per chat")).toBeInTheDocument();
    expect(screen.queryByText("Enquiries")).toBeNull();
    unmount();
    render(<WorkspaceHome business={business} creatives={[]} campaigns={[chat("a")]} audit={[]} metaReady spend={null} results={{ a: result("a") }} locale="hi" />);
    expect(screen.getByText("चैट")).toBeInTheDocument();
    expect(screen.getByText("हर चैट")).toBeInTheDocument();
  });

  it("counts chats nobody has logged yet; any logged enquiry or customer, or unknown counts, ends the ask", () => {
    expect(unloggedChats([chat("a"), chat("b", "completed")], { a: result("a", { real_enquiries: 0, customers: 0 }), b: result("b", { conversations: 2, real_enquiries: 0, customers: 0 }) })).toBe(5);
    expect(unloggedChats([chat("a")], { a: result("a", { real_enquiries: 1, customers: 0 }) })).toBe(0);
    expect(unloggedChats([chat("a")], { a: result("a", { real_enquiries: 0, customers: 1 }) })).toBe(0);
    expect(unloggedChats([chat("a")], { a: result("a") })).toBe(0);
    expect(unloggedChats([form("f")], { f: result("f", { real_enquiries: 0, customers: 0 }) })).toBe(0);
    expect(unloggedChats([chat("a", "draft")], { a: result("a", { real_enquiries: 0, customers: 0 }) })).toBe(0);
  });

  it("asks which chats were real enquiries, after Review, linking to Enquiries", () => {
    const creatives = [{ id: "c", status: "draft" as const, created_at: new Date().toISOString() }];
    const queue = buildWorkQueue({ business, creatives, campaigns: [], metaReady: true, unloggedChats: 3 });
    expect(queue.map((item) => item.id).slice(0, 2)).toEqual(["review", "chats"]);
    expect(queue[1]).toMatchObject({ title: "Which of your 3 chats were real enquiries?", detail: "Add each real one so you can see what an enquiry costs you.", action: "Add enquiries", href: "/leads", tone: "work" });
    expect(buildWorkQueue({ business, creatives: [], campaigns: [], metaReady: true, unloggedChats: 3, locale: "hi" }).find((item) => item.id === "chats"))
      .toMatchObject({ title: "आपकी 3 चैट में से कौन-सी असली पूछताछ थीं?", action: "पूछताछ जोड़ें" });
    expect(buildWorkQueue({ business, creatives, campaigns: [], metaReady: true, unloggedChats: 0 }).some((item) => item.id === "chats")).toBe(false);
  });
});
