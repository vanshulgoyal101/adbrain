import { describe, expect, it } from "vitest";
import { STEPS, funnelSql, render, summarize } from "../scripts/funnel.mjs";

const row = (user: string, reached: string[], extra: Record<string, unknown> = {}) => ({
  user, signed_up_at: "2026-10-22 10:01:00+00", last_seen: "2026-10-22 16:57:00+00",
  ...Object.fromEntries(STEPS.slice(1).map(([key]) => [key, reached.includes(key)])),
  ...extra,
});

describe("activation funnel (#338)", () => {
  it("builds one read-only-safe query for the window, excluding the smoke account by email", () => {
    const sql = funnelSql(14, ["Smoke@Example.com", "o'brien@example.com"]);
    expect(sql).toContain("make_interval(days => 14)");
    expect(sql).toContain("array['smoke@example.com','o''brien@example.com']::text[]");
    expect(sql).toContain("'/api/meta/oauth/start'");
    expect(sql).not.toMatch(/;\s*\S/);
    expect(funnelSql(7, [])).toContain("array[]::text[]");
  });

  it("rejects a window that isn't a whole number of days", () => {
    for (const days of [0, -1, 1.5, 400, Number.NaN]) expect(() => funnelSql(days, [])).toThrow();
  });

  it("reports each user's furthest step, even past a skipped one, and counts each step", () => {
    const summary = summarize([
      row("aaaaaaaa", ["brand", "ad", "approved", "campaigns"]),
      row("bbbbbbbb", ["brand"]),
      row("cccccccc", ["brand", "ad", "approved", "campaigns", "connect_clicked", "meta_connected", "campaign"]),
    ]);
    expect(summary.users.map(({ user, lastStep }: { user: string; lastStep: string }) => [user, lastStep])).toEqual([
      ["aaaaaaaa", "Campaigns opened"], ["bbbbbbbb", "Brand saved"], ["cccccccc", "Campaign created"],
    ]);
    expect(summary.totals).toEqual([
      ["Signed up", 3], ["Brand saved", 3], ["First ad generated", 2], ["Ad approved", 2], ["Campaigns opened", 2],
      ["Connect Meta clicked", 1], ["Meta connected", 1], ["Top-up paid", 0], ["Campaign created", 1], ["First lead/chat", 0],
    ]);
  });

  it("prints a row per user plus totals, with id prefixes and no other identity", () => {
    const text = render(summarize([row("aaaaaaaa", ["brand", "ad", "approved", "campaigns"], { email: "x@example.com" })]), 14);
    expect(text).toContain("Sign-ups in the last 14 days: 1");
    expect(text).toMatch(/aaaaaaaa\s+2026-10-22 10:01\s+Campaigns opened\s+2026-10-22 16:57\s+✓✓✓✓✓·····/);
    expect(text).toMatch(/Campaigns opened\s+1/);
    expect(text).not.toContain("example.com");
  });

  it("says so when nobody signed up", () => {
    expect(render(summarize([]), 3)).toContain("Sign-ups in the last 3 days: 0");
  });
});
