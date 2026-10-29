import { describe, expect, it } from "vitest";
import { PILOT_DAY7_REASONS, pilotDay7Visible } from "@/lib/feedback/pilot-day7";
import { sanitizeProductEvent } from "@/lib/observability/events";

// #1650 (CPO #1644): after a pilot's first week, Home asks once whether they'd pay ₹999 a month.
const launch = "2026-10-01T09:00:00Z";
const day = (n: number) => new Date(Date.parse(launch) + n * 86_400_000);
const base = { exempt: false, firstLaunchAt: launch, events: [] as { name: string; created_at: string }[] };

describe("pilot day-7 question (#1650)", () => {
  it("appears 7 days after the first Go live, not before", () => {
    expect(pilotDay7Visible({ ...base, now: day(6.9) })).toBe(false);
    expect(pilotDay7Visible({ ...base, now: day(7) })).toBe(true);
    expect(pilotDay7Visible({ ...base, firstLaunchAt: null, now: day(30) })).toBe(false);
  });

  it("never shows to an exempt business (managed, operator-funded or the team's own)", () => {
    expect(pilotDay7Visible({ ...base, exempt: true, now: day(8) })).toBe(false);
  });

  it("goes away once answered", () => {
    expect(pilotDay7Visible({ ...base, events: [{ name: "pilot_day7", created_at: day(7.5).toISOString() }], now: day(20) })).toBe(false);
  });

  it("'Not now' hides it for 3 days, and it shows at most twice", () => {
    const once = [{ name: "pilot_day7.dismissed", created_at: day(7).toISOString() }];
    expect(pilotDay7Visible({ ...base, events: once, now: day(9.9) })).toBe(false);
    expect(pilotDay7Visible({ ...base, events: once, now: day(10) })).toBe(true);
    const twice = [...once, { name: "pilot_day7.dismissed", created_at: day(10).toISOString() }];
    expect(pilotDay7Visible({ ...base, events: twice, now: day(40) })).toBe(false);
  });

  it("offers the CPO's reasons per answer", () => {
    expect(PILOT_DAY7_REASONS.yes).toEqual(["brings_enquiries", "saves_time", "sees_cost"]);
    expect(PILOT_DAY7_REASONS.no).toEqual(["few_enquiries", "too_expensive", "hard_to_use", "prefer_meta", "other"]);
    expect(PILOT_DAY7_REASONS.maybe).toEqual(PILOT_DAY7_REASONS.no);
  });

  it("the event keeps the answer codes and drops anything else", () => {
    const event = sanitizeProductEvent({ version: 1, eventId: crypto.randomUUID(), requestId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
      kind: "action", name: "pilot_day7", outcome: "success", userId: null, businessId: null,
      attributes: { answer: "no", reason: "too_expensive", days: 8, note: "free text" } });
    expect(event?.attributes).toMatchObject({ answer: "no", reason: "too_expensive", days: 8 });
    expect(event?.attributes).not.toHaveProperty("note");
  });
});
