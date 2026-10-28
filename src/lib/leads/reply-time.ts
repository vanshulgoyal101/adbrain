import { createClient } from "@/lib/supabase/server";
import { medianReplyMinutes } from "@/lib/leads/first-reply";
import { WAITING_COLUMNS, WAITING_WINDOW_MS, isWaitingLead, type WaitingLeadRow } from "@/lib/leads/waiting";

/** #1049: the median minutes from enquiry to the owner's first reply, over the last 30 days; null with none. */
export async function recentReplyMinutes(businessId: string, now = Date.now()): Promise<number | null> {
  const supabase = await createClient();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("leads").select("created_time, created_at, first_contacted_at")
    .eq("business_id", businessId).not("first_contacted_at", "is", null).gte("first_contacted_at", since).limit(1000);
  if (error) return null;
  return medianReplyMinutes(data ?? []);
}

/** #1274: enquiries from the last 24 h still "new" and never contacted (Meta test leads left out), for Home's "waiting" line. */
export async function waitingEnquiries(businessId: string, now = Date.now()): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").select(WAITING_COLUMNS).eq("business_id", businessId)
    .eq("workflow_status", "new").is("first_contacted_at", null)
    .gte("created_at", new Date(now - WAITING_WINDOW_MS).toISOString()).limit(500);
  if (error) return 0;
  return ((data ?? []) as WaitingLeadRow[]).filter(isWaitingLead).length;
}
