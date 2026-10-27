import { createClient } from "@/lib/supabase/server";
import { medianReplyMinutes } from "@/lib/leads/first-reply";

/** #1049: the median minutes from enquiry to the owner's first reply, over the last 30 days; null with none. */
export async function recentReplyMinutes(businessId: string, now = Date.now()): Promise<number | null> {
  const supabase = await createClient();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("leads").select("created_time, created_at, first_contacted_at")
    .eq("business_id", businessId).not("first_contacted_at", "is", null).gte("first_contacted_at", since).limit(1000);
  if (error) return null;
  return medianReplyMinutes(data ?? []);
}
