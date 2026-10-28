import { describe, expect, it } from "vitest";
import { isWaitingLead, waitingByCampaign } from "@/lib/leads/waiting";

const lead = (extra: Partial<Parameters<typeof isWaitingLead>[0]> = {}) =>
  ({ campaign_id: "c1", full_name: "Asha", workflow_status: "new", first_contacted_at: null, ...extra });

describe("waiting for your reply (#1274)", () => {
  it("counts new, untouched enquiries per campaign", () => {
    expect(waitingByCampaign([lead(), lead(), lead({ campaign_id: "c2" })])).toEqual({ c1: 2, c2: 1 });
  });

  it("Reviewer #1339: a lead the owner marked contacted by hand isn't waiting, though Reply was never tapped", () => {
    expect(isWaitingLead(lead({ workflow_status: "contacted" }))).toBe(false);
    expect(isWaitingLead(lead({ workflow_status: "customer" }))).toBe(false);
    expect(waitingByCampaign([lead({ workflow_status: "contacted" })])).toEqual({});
  });

  it("leaves out tapped-Reply leads, Meta test leads and leads with no campaign", () => {
    expect(isWaitingLead(lead({ first_contacted_at: "2026-10-28T10:00:00Z" }))).toBe(false);
    expect(isWaitingLead(lead({ full_name: "<test lead: dummy data for full_name>" }))).toBe(false);
    expect(waitingByCampaign([lead({ campaign_id: null })])).toEqual({});
  });
});
