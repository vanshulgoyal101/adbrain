import { describe, expect, it } from "vitest";
import { waitingByCampaign, type WaitingLeadRow } from "@/lib/leads/waiting";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const lead = (extra: Partial<WaitingLeadRow> = {}): WaitingLeadRow =>
  ({ campaign_id: "c1", full_name: "Asha", workflow_status: "new", first_contacted_at: null, created_time: "2026-10-28T09:00:00Z", created_at: "2026-10-28T09:00:00Z", ...extra });

// #1274: the card's and Home's "waiting for your reply" count uses the inbox's Waiting rule (#1260).
describe("waitingByCampaign (#1274)", () => {
  it("counts new, untouched enquiries per campaign", () => {
    expect(waitingByCampaign([lead(), lead(), lead({ campaign_id: "c2" })], NOW)).toEqual({ c1: 2, c2: 1 });
  });

  it("Reviewer #1339: a lead the owner marked contacted by hand isn't waiting, though Reply was never tapped", () => {
    expect(waitingByCampaign([lead({ workflow_status: "contacted" }), lead({ workflow_status: "customer" })], NOW)).toEqual({});
  });

  it("leaves out tapped-Reply leads, Meta test leads, old leads and leads with no campaign", () => {
    expect(waitingByCampaign([
      lead({ first_contacted_at: "2026-10-28T10:00:00Z" }),
      lead({ full_name: "<test lead: dummy data for full_name>" }),
      lead({ created_time: "2026-10-01T09:00:00Z" }),
      lead({ campaign_id: null }),
    ], NOW)).toEqual({});
  });
});
