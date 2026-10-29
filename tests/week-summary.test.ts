import { describe, expect, it } from "vitest";
import { weekBounds, weekDiff, weekSummary } from "@/lib/home/week-summary";

// #1668 (CPO, #1654): Home's Monday "last week" card.
describe("weekBounds (IST Monday to Sunday)", () => {
  it("Monday 00:30 IST is this week; Sunday 23:30 IST is still last week", () => {
    // Mon 2 Nov 2026 00:30 IST = Sun 1 Nov 19:00 UTC.
    expect(weekBounds(new Date("2026-11-01T19:00:00Z"))).toEqual({ lastStart: "2026-10-25T18:30:00.000Z", thisStart: "2026-11-01T18:30:00.000Z" });
    // Sun 1 Nov 23:30 IST = 18:00 UTC: the week that started Mon 26 Oct.
    expect(weekBounds(new Date("2026-11-01T18:00:00Z"))).toEqual({ lastStart: "2026-10-18T18:30:00.000Z", thisStart: "2026-10-25T18:30:00.000Z" });
  });
});

describe("weekDiff (cumulative snapshots)", () => {
  it("subtracts the snapshot before last Monday from the one before this Monday", () => {
    expect(weekDiff({ spend: 400, conversations: 3, whatsapp_opens: 20 }, { spend: 1150, conversations: 9, whatsapp_opens: 61 })).toEqual({ spend: 750, chats: 6, opens: 41 });
  });
  it("a campaign that started mid-week counts from 0; one with no snapshot yet counts nothing", () => {
    expect(weekDiff(null, { spend: 300, conversations: 2, whatsapp_opens: null })).toEqual({ spend: 300, chats: 2, opens: 0 });
    expect(weekDiff(null, null)).toEqual({ spend: 0, chats: 0, opens: 0 });
  });
});

describe("weekSummary", () => {
  const diff = (spend: number, chats: number, opens = 0) => ({ spend, chats, opens });
  it("is hidden when the week had no spend and no logged enquiry", () => {
    expect(weekSummary({ diffs: [diff(0, 0)], enquiries: 0, running: false, bestAd: "Free survey" })).toBeNull();
    expect(weekSummary({ diffs: [], enquiries: 1, running: true, bestAd: null })).toMatchObject({ enquiries: 1, spend: 0 });
  });
  it("suggests quick questions when 30+ opens bring under 6 messages per 35", () => {
    expect(weekSummary({ diffs: [diff(900, 4, 40)], enquiries: 1, running: true, bestAd: null })?.suggestion).toBe("quick_questions");
    expect(weekSummary({ diffs: [diff(900, 7, 40)], enquiries: 1, running: true, bestAd: null })?.suggestion).toBeNull();
    expect(weekSummary({ diffs: [diff(900, 0, 29)], enquiries: 1, running: true, bestAd: null })?.suggestion).toBeNull();
  });
  it("then asks to log real enquiries when chats came in and none were logged", () => {
    expect(weekSummary({ diffs: [diff(500, 3, 10)], enquiries: 0, running: true, bestAd: null })?.suggestion).toBe("add_enquiries");
  });
  it("then offers to run the best ad again when nothing is running; never to spend more", () => {
    expect(weekSummary({ diffs: [diff(500, 3, 10)], enquiries: 2, running: false, bestAd: " 'Diwali' " })).toEqual({ chats: 3, enquiries: 2, spend: 500, bestAd: "'Diwali'", suggestion: "run_again" });
    expect(weekSummary({ diffs: [diff(500, 3, 10)], enquiries: 2, running: true, bestAd: null })?.suggestion).toBeNull();
  });
});
