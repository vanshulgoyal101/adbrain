import { describe, expect, it } from "vitest";
import { pausedResultsReadDue } from "@/lib/campaign/paused-results";

// #1003: a paused campaign's results are read at pause + 1 day and pause + 7 days, then left as final.
describe("pausedResultsReadDue", () => {
  const P = Date.parse("2026-10-20T12:00:00Z");
  const at = (ms: number) => new Date(P + ms).toISOString();
  const H = 3_600_000, D = 24 * H;

  it("gives a campaign with no stored result one read, with or without a pause", () => {
    expect(pausedResultsReadDue(null, null, P)).toBe(true);
    expect(pausedResultsReadDue(at(0), null, P)).toBe(true);
  });

  it("waits a full day after the pause, then reads once", () => {
    expect(pausedResultsReadDue(at(0), at(-5 * 60_000), P + D - 1)).toBe(false);
    expect(pausedResultsReadDue(at(0), at(-5 * 60_000), P + D)).toBe(true);
    expect(pausedResultsReadDue(at(0), at(D), P + D + H)).toBe(false);
  });

  it("reads once more at 7 days, then never again", () => {
    expect(pausedResultsReadDue(at(0), at(D), P + 7 * D - 1)).toBe(false);
    expect(pausedResultsReadDue(at(0), at(D), P + 7 * D)).toBe(true);
    expect(pausedResultsReadDue(at(0), at(7 * D), P + 60 * D)).toBe(false);
  });

  it("catches up an old pause with one read, which covers both follow-ups", () => {
    expect(pausedResultsReadDue(at(0), at(-H), P + 30 * D)).toBe(true);
    expect(pausedResultsReadDue(at(0), at(30 * D), P + 31 * D)).toBe(false);
  });

  it("never reads a paused campaign with results but no AdBrain pause, or bad dates", () => {
    expect(pausedResultsReadDue(null, at(0), P + 30 * D)).toBe(false);
    expect(pausedResultsReadDue("not a date", at(0), P + 30 * D)).toBe(false);
  });
});
