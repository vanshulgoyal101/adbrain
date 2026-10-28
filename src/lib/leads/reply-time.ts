import { createClient } from "@/lib/supabase/server";
import { medianReplyMinutes } from "@/lib/leads/first-reply";
import { isWaiting, MIN_CONTACTED_FOR_MEDIAN, WAITING_DAYS } from "@/lib/leads/waiting";

const DAY = 24 * 60 * 60 * 1000;

/** #1049: the median minutes from enquiry to the owner's first reply, over the last 30 days; null with none. */
export async function recentReplyMinutes(businessId: string, now = Date.now()): Promise<number | null> {
  const supabase = await createClient();
  const since = new Date(now - 30 * DAY).toISOString();
  const { data, error } = await supabase.from("leads").select("created_time, created_at, first_contacted_at")
    .eq("business_id", businessId).not("first_contacted_at", "is", null).gte("first_contacted_at", since).limit(1000);
  if (error) return null;
  return medianReplyMinutes(data ?? []);
}

/**
 * #1292: the newest enquiry from the last 24 hours that is still waiting for a first reply (the inbox's
 * `isWaiting` rule), for Home's "{name} tapped your ad at {time}" line. null with none or on a read error.
 */
export async function newestWaitingEnquiry(businessId: string, now = Date.now()): Promise<{ name: string | null; at: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").select("full_name, first_contacted_at, workflow_status, created_time, created_at")
    .eq("business_id", businessId).eq("workflow_status", "new").is("first_contacted_at", null)
    .gte("created_at", new Date(now - DAY).toISOString()).order("created_at", { ascending: false }).limit(50);
  if (error) return null;
  const newest = (data ?? [])
    .filter((lead) => isWaiting(lead, now) && Date.parse(lead.created_time ?? lead.created_at) >= now - DAY)
    .map((lead) => ({ name: lead.full_name, at: lead.created_time ?? lead.created_at }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return newest ?? null;
}

/**
 * #1260: the Enquiries inbox's top sentence: how many people wait for a first contact, and the median minutes
 * to contact over 30 days (only with at least 3 contacted enquiries, CPO). An unreadable count is null (no sentence).
 */
export async function inboxSummary(businessId: string, now = Date.now()): Promise<{ waiting: number | null; replyMinutes: number | null }> {
  const supabase = await createClient();
  const [waiting, replies] = await Promise.all([
    // created_at is never earlier than created_time, so this over-selects; isWaiting applies the exact rule.
    supabase.from("leads").select("full_name, first_contacted_at, workflow_status, created_time, created_at")
      .eq("business_id", businessId).eq("workflow_status", "new").is("first_contacted_at", null)
      .gte("created_at", new Date(now - WAITING_DAYS * DAY).toISOString()).limit(1000),
    supabase.from("leads").select("created_time, created_at, first_contacted_at")
      .eq("business_id", businessId).not("first_contacted_at", "is", null).gte("first_contacted_at", new Date(now - 30 * DAY).toISOString()).limit(1000),
  ]);
  const contacted = replies.error ? [] : replies.data ?? [];
  return {
    waiting: waiting.error ? null : (waiting.data ?? []).filter((lead) => isWaiting(lead, now)).length,
    replyMinutes: contacted.length >= MIN_CONTACTED_FOR_MEDIAN ? medianReplyMinutes(contacted) : null,
  };
}
