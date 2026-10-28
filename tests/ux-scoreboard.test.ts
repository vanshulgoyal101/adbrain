import { describe, expect, it } from "vitest";
import { buildUxScoreboard, median, type UxLead, type UxOwner, type UxPageView } from "@/lib/observability/ux-scoreboard";

const until = new Date("2026-10-28T10:00:00Z");
const ago = (minutes: number) => new Date(until.getTime() - minutes * 60_000).toISOString();
const DAY = 24 * 60;
const board = (input: { owners?: UxOwner[]; liveOwnerIds?: string[]; leads?: UxLead[]; pageViews?: UxPageView[] }) =>
  buildUxScoreboard({ owners: [], liveOwnerIds: [], leads: [], pageViews: [], signupDays: 28, until, ...input });
const row = (b: ReturnType<typeof board>, prefix: string) => b.rows.find((r) => r.metric.startsWith(prefix))!;
const lead = (replyMinutes: number, extra: Partial<UxLead> = {}): UxLead => ({
  owner_id: "o1", test: false, created_time: ago(60 + replyMinutes), created_at: ago(60 + replyMinutes), first_contacted_at: ago(60), ...extra,
});

describe("UX scoreboard (#1226)", () => {
  it("median handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("times sign-up to first live over the sign-up window and counts who never went live", () => {
    const b = board({ owners: [
      { id: "a", created_at: ago(2 * DAY), first_live_at: ago(2 * DAY - 8) },
      { id: "b", created_at: ago(DAY), first_live_at: ago(DAY - 30) },
      { id: "c", created_at: ago(DAY), first_live_at: null },
      { id: "old", created_at: ago(40 * DAY), first_live_at: ago(40 * DAY - 1) },
    ] });
    const r = row(b, "Sign-up");
    expect(r.now).toBe("19 min (2 of 3 new owners live)");
    expect(r.met).toBe(false);
    expect(row(board({}), "Sign-up")).toMatchObject({ now: "no new owners in 28 d", met: null });
  });

  it("takes the median first reply over 7 days and never counts Meta test leads", () => {
    const b = board({ leads: [lead(4), lead(10), lead(600, { test: true }), lead(900, { first_contacted_at: ago(8 * DAY) })] });
    expect(row(b, "Time to first reply")).toMatchObject({ now: "7 min (2 replies)", met: true });
    expect(row(board({}), "Time to first reply")).toMatchObject({ now: "no replies in 7 d", met: null });
  });

  it("counts distinct IST days with a results page per owner with a live campaign", () => {
    const view = (user_id: string, at: string, route = "/dashboard"): UxPageView => ({ user_id, route, created_at: at });
    const b = board({
      liveOwnerIds: ["o1", "o2"],
      pageViews: [
        // 18:00Z and 19:00Z on the same UTC day fall on two IST days (23:30 and 00:30 IST).
        view("o1", "2026-10-26T18:00:00.000Z"), view("o1", "2026-10-26T19:00:00.000Z"), view("o1", ago(60), "/leads"),
        view("o1", ago(90), "/campaigns"), view("o2", ago(60)), view("o2", ago(60), "/settings"),
        view("o2", ago(9 * DAY)), view("stranger", ago(60)),
      ],
    });
    expect(row(b, "Weekly return")).toMatchObject({ now: "2 d/week (1 of 2 owners ≥ 3)", met: false });
    expect(row(board({}), "Weekly return")).toMatchObject({ now: "no owners with a live campaign", met: null });
  });

  it("marks walk-measured rows as unmeasured and renders one table", () => {
    const b = board({});
    expect(b.rows.filter((r) => r.met === null)).toHaveLength(6);
    expect(b.markdown).toContain("| Metric | Now | Target by Nov 30 | Met |");
    expect(b.markdown).toContain("internal and smoke accounts excluded");
    expect(b.markdown).toContain("0 of 0 measured rows meet target");
  });
});
