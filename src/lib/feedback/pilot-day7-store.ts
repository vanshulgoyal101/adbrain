import { isInternalUser } from "@/lib/internal-accounts";
import { fundingMode } from "@/lib/payments/operator-funding";
import { createAdminClient } from "@/lib/supabase/admin";
import { PILOT_DAY7_DISMISSED, PILOT_DAY7_EVENT } from "./pilot-day7";

/**
 * #1650: what decides the day-7 question for a business: exempt (managed, operator-funded or the team's own, as
 * the plan's exemption), its first Go live, and its earlier answer or 'Not now' events. Throws when unreadable.
 */
export async function pilotDay7Facts(businessId: string): Promise<{ exempt: boolean; firstLaunchAt: string | null; events: { name: string; created_at: string }[] }> {
  const db = createAdminClient();
  const [business, launch, events, mode] = await Promise.all([
    db.from("businesses").select("owner_id").eq("id", businessId).maybeSingle(),
    db.from("campaigns").select("launched_at").eq("business_id", businessId).not("launched_at", "is", null).order("launched_at").limit(1),
    db.from("product_events").select("name, created_at").eq("business_id", businessId).in("name", [PILOT_DAY7_EVENT, PILOT_DAY7_DISMISSED]).limit(10),
    fundingMode(businessId),
  ]);
  if (business.error || !business.data || launch.error || events.error) throw new Error("Pilot question is unavailable.");
  const { data: owner, error } = await db.auth.admin.getUserById(business.data.owner_id);
  if (error || !owner?.user) throw new Error("Pilot question is unavailable.");
  return {
    exempt: mode !== "own" || isInternalUser(owner.user),
    firstLaunchAt: launch.data[0]?.launched_at ?? null,
    events: (events.data ?? []) as { name: string; created_at: string }[],
  };
}
