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
