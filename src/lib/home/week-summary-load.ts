import type { SupabaseClient } from "@supabase/supabase-js";
import { adResultsEnabled, adResultViews, type StoredAdResult } from "@/lib/campaign/ad-results-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Campaign } from "@/lib/types";
import { WEEK_DISMISS_ACTION, weekBounds, weekDiff, weekSummary, type Snapshot, type WeekSummary } from "./week-summary";

type Store = Pick<SupabaseClient, "from">;

/** The latest snapshot of a campaign before `at`; null when it had none yet. */
async function snapshotBefore(database: Store, campaignId: string, at: string): Promise<Snapshot | null> {
  const { data, error } = await database.from("campaign_results").select("spend,conversations,whatsapp_opens")
    .eq("campaign_id", campaignId).lt("fetched_at", at).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Results could not be read.");
  return (data as Snapshot | null) ?? null;
}

/** #783's "best so far" ad name across the campaigns' stored per-ad results; null when there is none. */
async function bestAdName(database: Store, campaigns: Pick<Campaign, "id" | "destination">[]): Promise<string | null> {
  if (!adResultsEnabled()) return null;
  for (const campaign of campaigns) {
    const { data } = await database.from("ad_results")
      .select("meta_ad_id,ad_name,effective_status,delivered,impressions,link_clicks,conversations,leads,spend_paise,synced_at")
      .eq("campaign_id", campaign.id).is("period_start", null).is("period_end", null).limit(100);
    const best = adResultViews((data ?? []) as StoredAdResult[], campaign.destination === "whatsapp").ads.find((ad) => ad.best);
    if (best?.name) return best.name;
  }
  return null;
}

/** Whether the owner dismissed this week's card (a `ui.action` product event since this Monday). */
async function dismissed(businessId: string, since: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("product_events").select("id").eq("business_id", businessId)
      .eq("name", "ui.action").eq("attributes->>action", WEEK_DISMISS_ACTION).gte("created_at", since).limit(1);
    return Boolean(data?.length);
  } catch {
    return false;
  }
}

/**
 * #1668: last Monday-to-Sunday (IST) for Home, or null when that week had no spend and no logged enquiry, or the owner
 * dismissed it. Owner-scoped reads (RLS); no Meta call.
 */
export async function loadWeekSummary(businessId: string, campaigns: Campaign[], now = new Date()): Promise<WeekSummary | null> {
  const { lastStart, thisStart } = weekBounds(now);
  if (await dismissed(businessId, thisStart)) return null;
  const supabase = (await createClient()) as unknown as Store;
  const launched = campaigns.filter((campaign) => campaign.meta_campaign_id);
  const [diffs, enquiries, bestAd] = await Promise.all([
    Promise.all(launched.map(async (campaign) => weekDiff(
      await snapshotBefore(supabase, campaign.id, lastStart), await snapshotBefore(supabase, campaign.id, thisStart)))),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", businessId)
      .gte("created_at", lastStart).lt("created_at", thisStart).then(({ count, error }) => {
        if (error) throw new Error("Enquiries could not be read.");
        return count ?? 0;
      }),
    bestAdName(supabase, launched).catch(() => null),
  ]);
  return weekSummary({ diffs, enquiries, running: campaigns.some((campaign) => campaign.status === "active"), bestAd });
}
