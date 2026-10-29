import { describe, expect, it, vi } from "vitest";
import { pauseEndedRun, runningNow } from "@/lib/campaign/activation";
import { cardVerdictInput, homeVerdicts } from "@/lib/campaign/card-verdict";
import { verdict } from "@/lib/campaign/verdict";

// #2281: the Solaride WhatsApp arm's shape. A 2-day capped run whose end time passed, Meta stopped at ₹444.12
// of ₹450, no customer-funds reservation, and the row still 'active' until the sweep moves it.
const END = "2026-10-29T15:30:29.000Z";
const NOW = Date.parse("2026-10-29T16:00:00Z");
const arm = {
  id: "arm", status: "active" as const, created_at: "2026-10-27T15:30:00Z", destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT",
  raw: { cap: { adSetId: "capped-1", lifetimeBudgetPaise: 45_000, endTime: END, days: 2 } },
};
const result = { impressions: 9220, spend: 444.12, leads: 0, conversations: 3, whatsapp_opens: 21, destination: "whatsapp" };
const extra = { now: NOW, waiting: 0, weakAd: null, comparison: null };

describe("an ended capped run reads as ended everywhere (#2281)", () => {
  it("gets an ended verdict on its card, not Live", () => {
    const input = cardVerdictInput(arm as never, result as never, extra)!;
    expect(input.status).toBe("completed");
    expect(verdict(input).state).toMatch(/^ended_/);
  });

  it("stays ended once the sweep has paused it", () => {
    expect(verdict(cardVerdictInput({ ...arm, status: "paused" } as never, result as never, extra)!).state).toMatch(/^ended_/);
  });

  it("is not counted as running (header, Home)", () => {
    expect(runningNow(arm, NOW)).toBe(false);
    expect(homeVerdicts([arm] as never, { arm: result } as never, { now: NOW, waiting: 0 }).lead).toBeNull();
  });

  it("is live until its end time", () => {
    const before = Date.parse(END) - 60_000;
    expect(runningNow(arm, before)).toBe(true);
    expect(cardVerdictInput(arm as never, result as never, { ...extra, now: before })!.status).toBe("active");
    expect(homeVerdicts([arm] as never, { arm: result } as never, { now: before, waiting: 0 }).lead?.campaignId).toBe("arm");
  });

  it("leaves an uncapped run's status alone", () => {
    expect(runningNow({ status: "active", raw: {} }, NOW)).toBe(true);
    expect(cardVerdictInput({ ...arm, raw: {} } as never, result as never, extra)!.status).toBe("active");
  });
});

// #2301: L2's stored tree (production row read Oct 29, Meta ids replaced): the source ad set and its 3 ads,
// then the capped copy and its 3 ads. At 16:39Z Meta had the capped ad set and its ads still ACTIVE.
const l2 = {
  meta_campaign_id: "900000000000001",
  meta_adset_id: "900000000000002",
  meta_ad_ids: ["900000000000003", "900000000000004", "900000000000005", "900000000000006", "900000000000007", "900000000000008"],
  raw: {
    source: "campaign_operation",
    metaResult: {
      campaignId: "900000000000001", adSetId: "900000000000002", adSetIds: ["900000000000002", "900000000000009"],
      adIds: ["900000000000003", "900000000000004", "900000000000005", "900000000000006", "900000000000007", "900000000000008"],
      creativeIds: ["900000000000010", "900000000000011", "900000000000012"], destination: "whatsapp",
    },
    cap: { days: 2, adIds: ["900000000000006", "900000000000007", "900000000000008"], adSetId: "900000000000009", endTime: END, lifetimeBudgetPaise: 45_000 },
    cappedAdSetIds: ["900000000000009"],
  },
};
const tree = (status: (id: string) => string) => ({
  objects: [
    { id: l2.meta_campaign_id, level: "campaign" as const, status: "PAUSED", effectiveStatus: "PAUSED" },
    ...l2.raw.metaResult.adSetIds.map((id) => ({ id, level: "adset" as const, status: status(id), effectiveStatus: null })),
    ...l2.meta_ad_ids.map((id) => ({ id, level: "ad" as const, status: status(id), effectiveStatus: null })),
  ],
});

describe("the sweep stops an ended capped run whole (#2301)", () => {
  it("pauses the campaign, both ad sets and all six ads, so the card can turn it on capped again", async () => {
    const pauseCampaignTree = vi.fn(async () => ({ confirmed: true, ...tree(() => "PAUSED") }));
    const updateCampaignStatus = vi.fn();
    expect(await pauseEndedRun({ pauseCampaignTree, updateCampaignStatus }, l2 as never)).toBe(true);
    expect(pauseCampaignTree).toHaveBeenCalledWith(l2.meta_campaign_id, { adSetIds: l2.raw.metaResult.adSetIds, adIds: l2.meta_ad_ids });
    expect(updateCampaignStatus).not.toHaveBeenCalled();
    // The card's activationCapped: every ad set and ad PAUSED.
    const children = tree(() => "PAUSED").objects.filter((object) => object.level !== "campaign");
    expect(children).toHaveLength(8);
    expect(children.every((child) => child.status === "PAUSED")).toBe(true);
  });

  it("reports a child Meta didn't confirm, and stops anyway once the campaign is paused", async () => {
    const pauseCampaignTree = vi.fn(async () => ({ confirmed: false, ...tree((id) => (id === "900000000000009" ? "ACTIVE" : "PAUSED")) }));
    expect(await pauseEndedRun({ pauseCampaignTree, updateCampaignStatus: vi.fn() }, l2 as never)).toBe(false);
  });

  it("fails when Meta didn't confirm the campaign itself", async () => {
    const pauseCampaignTree = vi.fn(async () => ({ confirmed: false, objects: [{ id: l2.meta_campaign_id, level: "campaign" as const, status: "ACTIVE", effectiveStatus: "ACTIVE" }] }));
    await expect(pauseEndedRun({ pauseCampaignTree, updateCampaignStatus: vi.fn() }, l2 as never)).rejects.toThrow("campaign pause");
  });

  it("pauses the campaign only when the row has no tree on record", async () => {
    const pauseCampaignTree = vi.fn();
    const updateCampaignStatus = vi.fn(async () => undefined);
    expect(await pauseEndedRun({ pauseCampaignTree, updateCampaignStatus } as never, { ...l2, raw: { cap: l2.raw.cap } } as never)).toBe(true);
    expect(updateCampaignStatus).toHaveBeenCalledWith(l2.meta_campaign_id, "PAUSED");
    expect(pauseCampaignTree).not.toHaveBeenCalled();
  });
});
