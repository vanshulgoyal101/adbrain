import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, calls: [] as unknown[][] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "is", "gte", "order"]) chain[method] = (...args: unknown[]) => { db.calls.push([method, ...args]); return chain; };
    chain.limit = async () => ({ data: db.rows, error: db.error });
    return chain;
  },
}));

import { newestWaitingEnquiry } from "@/lib/leads/reply-time";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const lead = (extra: Record<string, unknown> = {}) =>
  ({ full_name: "Asha", workflow_status: "new", first_contacted_at: null, created_time: "2026-10-28T09:00:00Z", created_at: "2026-10-28T09:00:05Z", ...extra });

describe("newestWaitingEnquiry (#1292)", () => {
  beforeEach(() => { db.rows = []; db.error = null; db.calls = []; });

  it("returns the newest waiting enquiry from the last 24 hours, by when they tapped the ad", async () => {
    db.rows = [lead(), lead({ full_name: "Rohit", created_time: "2026-10-28T10:30:00Z", created_at: "2026-10-28T08:00:00Z" })];
    expect(await newestWaitingEnquiry("b1", NOW)).toEqual({ name: "Rohit", at: "2026-10-28T10:30:00Z" });
    expect(db.calls).toContainEqual(["eq", "business_id", "b1"]);
    expect(db.calls).toContainEqual(["gte", "created_at", "2026-10-27T12:00:00.000Z"]);
  });

  it("uses the inbox's waiting rule and the 24-hour window", async () => {
    db.rows = [
      lead({ created_time: "2026-10-27T11:00:00Z" }),
      lead({ full_name: "<test lead: dummy data for full_name>", created_time: "2026-10-28T11:00:00Z" }),
      lead({ workflow_status: "contacted" }),
    ];
    expect(await newestWaitingEnquiry("b1", NOW)).toBeNull();
  });

  it("is null on a read error", async () => {
    db.rows = [lead()];
    db.error = { message: "boom" };
    expect(await newestWaitingEnquiry("b1", NOW)).toBeNull();
  });
});
