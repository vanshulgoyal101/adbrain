import { isMetaTestLead } from "@/lib/leads/test-lead";

/** #1274: how far back an uncontacted enquiry still counts as "waiting for your reply". */
export const WAITING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WAITING_COLUMNS = "campaign_id, full_name, workflow_status, first_contacted_at";

export interface WaitingLeadRow {
  campaign_id: string | null;
  full_name: string | null;
  workflow_status: string | null;
  first_contacted_at: string | null;
}

/**
 * A lead waits for a reply only while it is still "new" and nobody tapped Reply/Call. An owner who replied on
 * WhatsApp and set the status by hand leaves `first_contacted_at` null, so the status decides (Reviewer, #1339).
 */
export function isWaitingLead(lead: WaitingLeadRow): boolean {
  return lead.workflow_status === "new" && lead.first_contacted_at === null && !isMetaTestLead(lead);
}

/** Waiting enquiries per campaign id. */
export function waitingByCampaign(rows: WaitingLeadRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of rows) if (lead.campaign_id && isWaitingLead(lead)) counts[lead.campaign_id] = (counts[lead.campaign_id] ?? 0) + 1;
  return counts;
}
