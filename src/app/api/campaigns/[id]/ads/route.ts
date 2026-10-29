import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { adCreativeLinks, adResultsEnabled, adResultViews, type AdCreative, type StoredAdResult } from "@/lib/campaign/ad-results-store";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { OWNER_ERRORS } from "@/lib/copy/owner-words";

export const runtime = "nodejs";

/** #783: "Which ad worked": each ad's stored results for the campaign card. Read-only; no Meta call. */
export const GET = observeRoute("/api/campaigns/[id]/ads", "GET", async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!adResultsEnabled()) return apiError("Not found", 404);
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  // RLS scopes every read to the owner's own campaigns and creatives.
  const { data: campaign } = await supabase.from("campaigns")
    .select("id, destination, creative_ids, meta_campaign_id, meta_adset_id, meta_ad_ids, raw").eq("id", id).maybeSingle();
  if (!campaign) return apiError(OWNER_ERRORS.campaignNotFound, 404);
  const { data, error } = await (supabase as unknown as SupabaseClient).from("ad_results")
    .select("meta_ad_id, ad_name, effective_status, delivered, impressions, link_clicks, conversations, leads, spend_paise, synced_at")
    .eq("campaign_id", id).is("period_start", null).is("period_end", null).limit(100);
  if (error) return apiError("Ad results are unavailable. Try again.", 503);
  const links = adCreativeLinks({ ...campaign, meta_ad_ids: campaign.meta_ad_ids ?? [] }, campaign.creative_ids ?? []);
  const creatives = new Map<string, AdCreative>();
  if (links.size) {
    // Best effort: without the creatives, the rows keep Meta's names.
    const { data: rows } = await supabase.from("creatives").select("id, headline, image_url").in("id", [...new Set([...links.values()].map(link => link.creativeId))]);
    for (const row of rows ?? []) creatives.set(row.id, { headline: row.headline, imageUrl: row.image_url });
  }
  return NextResponse.json({ ok: true, ...adResultViews((data ?? []) as StoredAdResult[], campaign.destination === "whatsapp", { links, creatives }) });
});
