import { describe, expect, it } from "vitest";
import { runningNow } from "@/lib/campaign/activation";
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
