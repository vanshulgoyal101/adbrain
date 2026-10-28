import { describe, expect, it } from "vitest";
import { isWaiting } from "@/lib/leads/waiting";

const now = Date.parse("2026-10-28T12:00:00.000Z");
const lead = (over: Record<string, unknown> = {}) => ({
  full_name: "Asha Verma", first_contacted_at: null, workflow_status: "new", created_time: "2026-10-27T12:00:00.000Z", created_at: "2026-10-27T12:01:00.000Z", ...over,
}) as Parameters<typeof isWaiting>[0];

// #1260 (CPO): waiting = no first contact, still New, received in the last 7 days, not Meta's test lead.
describe("isWaiting", () => {
  it("counts a new, uncontacted enquiry from this week", () => expect(isWaiting(lead(), now)).toBe(true));
  it.each([
    ["contacted", { first_contacted_at: "2026-10-27T12:05:00.000Z" }],
    ["moved on from New", { workflow_status: "customer" }],
    ["older than 7 days", { created_time: "2026-10-21T11:59:00.000Z" }],
    ["Meta's test lead", { full_name: "<test lead: dummy data for full_name>" }],
  ])("leaves out an enquiry %s", (_label, over) => expect(isWaiting(lead(over), now)).toBe(false));
  it("uses when it reached AdBrain when Meta gave no time, and treats a missing status as New", () => {
    expect(isWaiting(lead({ created_time: null, workflow_status: null }), now)).toBe(true);
  });
});
