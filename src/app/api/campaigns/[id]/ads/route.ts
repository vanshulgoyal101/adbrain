import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { adResultsEnabled, adResultViews, type StoredAdResult } from "@/lib/campaign/ad-results-store";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

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

  // RLS scopes both reads to the owner's own campaigns.
  const { data: campaign } = await supabase.from("campaigns").select("id, destination").eq("id", id).maybeSingle();
  if (!campaign) return apiError("Campaign not found", 404);
  const { data, error } = await (supabase as unknown as SupabaseClient).from("ad_results")
    .select("meta_ad_id, ad_name, effective_status, delivered, impressions, link_clicks, conversations, leads, spend_paise, synced_at")
    .eq("campaign_id", id).is("period_start", null).is("period_end", null).limit(100);
  if (error) return apiError("Ad results are unavailable. Try again.", 503);
  return NextResponse.json({ ok: true, ...adResultViews((data ?? []) as StoredAdResult[], campaign.destination === "whatsapp") });
});
