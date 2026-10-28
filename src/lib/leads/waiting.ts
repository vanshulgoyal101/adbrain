import type { Lead } from "@/lib/types";
import { isMetaTestLead } from "./test-lead";

export const WAITING_DAYS = 7;
export const MIN_CONTACTED_FOR_MEDIAN = 3;

/**
 * #1260 (CPO): 'waiting' = a real enquiry nobody has contacted yet (no `first_contacted_at`, still New),
 * received in the last 7 days. The inbox's Waiting view and its top sentence use the same rule.
 */
export function isWaiting(lead: Pick<Lead, "full_name" | "first_contacted_at" | "workflow_status" | "created_time" | "created_at">, now = Date.now()): boolean {
  if (lead.first_contacted_at || (lead.workflow_status ?? "new") !== "new" || isMetaTestLead(lead)) return false;
  const received = Date.parse(lead.created_time ?? lead.created_at);
  return Number.isFinite(received) && received >= now - WAITING_DAYS * 24 * 60 * 60 * 1000;
}

/** #1274: the columns `isWaiting` reads, plus the campaign, for the card's and Home's "waiting for your reply". */
export const WAITING_COLUMNS = "campaign_id, full_name, first_contacted_at, workflow_status, created_time, created_at";
export type WaitingLeadRow = Pick<Lead, "campaign_id" | "full_name" | "first_contacted_at" | "workflow_status" | "created_time" | "created_at">;

/** Waiting enquiries per campaign id, by the inbox's rule, so the card's count matches Enquiries' Waiting view. */
export function waitingByCampaign(rows: WaitingLeadRow[], now = Date.now()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of rows) if (lead.campaign_id && isWaiting(lead, now)) counts[lead.campaign_id] = (counts[lead.campaign_id] ?? 0) + 1;
  return counts;
}
