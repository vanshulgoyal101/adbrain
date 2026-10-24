import { describe, expect, it } from "vitest";
import { campaignWhatsAppSummary } from "@/lib/campaign/results-summary";
import type { Campaign, CampaignResult } from "@/lib/types";

// #372: a plain campaign summary the owner can forward on WhatsApp.
const campaign = (over: Partial<Campaign> = {}) => ({
  id: "c1", name: "Solaride Tricity WhatsApp", status: "active", daily_budget: 280, objective: "OUTCOME_ENGAGEMENT",
  destination: "whatsapp", raw: { cap: { adSetId: "a1", endTime: "2099-10-31T00:00:00Z", days: 7 } }, ...over,
}) as unknown as Campaign;
const result = (over: Partial<CampaignResult> = {}) => ({
  campaign_id: "c1", impressions: 900, clicks: 40, leads: 0, spend: 412.4, cpl: null,
  conversations: 6, cost_per_conversation: 68.73, destination: "whatsapp", fetched_at: "2026-10-24T09:00:00Z", ...over,
}) as unknown as CampaignResult;

describe("campaignWhatsAppSummary (#372)", () => {
  it("writes spend against the capped run's limit, chats, cost per chat and a next step", () => {
    expect(campaignWhatsAppSummary(campaign(), result())).toBe([
      "Solaride Tricity WhatsApp",
      "Spent ₹412 of the ₹1,960 limit",
      "6 WhatsApp chats",
      "₹69 per chat",
      "Next: running fine, nothing to do.",
    ].join("\n"));
  });

  it("adds the owner's real enquiries when logged, and uses the daily budget without a cap", () => {
    const text = campaignWhatsAppSummary(campaign({ raw: {} }), result({ real_enquiries: 2 }));
    expect(text).toContain("Spent ₹412 (₹280 a day)");
    expect(text).toContain("6 WhatsApp chats, 2 real enquiries");
  });

  it("counts form leads for lead-form campaigns", () => {
    const text = campaignWhatsAppSummary(
      campaign({ destination: "instant_form", objective: "OUTCOME_LEADS" }),
      result({ destination: "instant_form", conversations: null, cost_per_conversation: null, leads: 1, cpl: 412.4 }),
    );
    expect(text.split("\n").slice(2, 4)).toEqual(["1 enquiry", "₹412 per enquiry"]);
  });

  it.each([
    [{ status: "paused" }, {}, "Next: paused. Open AdBrain to review and resume."],
    [{}, { spend: 0, conversations: 0, cost_per_conversation: null }, "Next: waiting for Meta to start showing the ad."],
    [{ raw: { health: { checkedAt: "2026-10-24T09:00:00Z", activeSince: "2026-10-20T00:00:00Z", flags: [{ kind: "not_delivering", reason: "No one has seen the ad for 2 days.", since: "2026-10-22T00:00:00Z", key: "abcdef123456" }] } } }, {}, "Next: needs a look. No one has seen the ad for 2 days."],
    [{ status: "completed" }, {}, "Next: finished. Open AdBrain to run it again."],
  ])("picks the next step from the campaign's state (%o)", (over, res, line) => {
    expect(campaignWhatsAppSummary(campaign(over as Partial<Campaign>), result(res)).split("\n").at(-1)).toBe(line);
  });

  it("says plainly when there are no chats yet", () => {
    const text = campaignWhatsAppSummary(campaign(), result({ conversations: 0, cost_per_conversation: null }));
    expect(text).toContain("No WhatsApp chats yet");
    expect(text).toContain("Cost per chat: not yet");
  });
});
