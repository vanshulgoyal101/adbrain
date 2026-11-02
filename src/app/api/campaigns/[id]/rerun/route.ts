import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { ownerError } from "@/i18n/request-locale";
import { AD_RESULT_COLUMNS, adResultsEnabled, type StoredAdResult } from "@/lib/campaign/ad-results-store";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";
import { bestCreativeId, rerunPrefill } from "@/lib/campaign/rerun";
import { preparedAudienceForm } from "@/lib/campaign/editor-targeting";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * #1050 "Run this again": the New campaign prefill copied from this campaign (its launch draft, else the
 * campaign row), with only still-approved ads, Best first. Read-only; no Meta call, nothing is created.
 */
export const GET = observeRoute("/api/campaigns/[id]/rerun", "GET", async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  // RLS scopes every read to the owner's own business.
  const { data: campaign } = await supabase.from("campaigns")
    .select("id, business_id, name, creative_ids, daily_budget, destination, raw").eq("id", id).maybeSingle();
  if (!campaign) return apiError(await ownerError("campaignNotFound"), 404);

  const { data: operation } = await supabase.from("campaign_operations")
    .select("draft_id").eq("campaign_id", id).eq("state", "succeeded")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const { data: draftRow } = operation
    ? await supabase.from("campaign_drafts").select("input").eq("id", operation.draft_id).maybeSingle()
    : { data: null };
  const draft = draftRow ? draftInputSchema.safeParse(draftRow.input).data ?? null : null;

  const wanted = [...new Set([...(draft?.creativeIds ?? []), ...(campaign.creative_ids ?? [])])];
  const { data: approved, error: creativeError } = wanted.length
    ? await supabase.from("creatives").select("id").eq("business_id", campaign.business_id).eq("status", "approved").in("id", wanted)
    : { data: [], error: null };
  if (creativeError) return apiError("Your ads couldn't be loaded. Try again.", 503);

  let best: string | null = null;
  if (adResultsEnabled()) {
    const database = supabase as unknown as SupabaseClient;
    const [results, links] = await Promise.all([
      database.from("ad_results")
        .select(AD_RESULT_COLUMNS)
        .eq("campaign_id", id).is("period_start", null).is("period_end", null).limit(100),
      database.from("campaign_ads").select("meta_ad_id, creative_id").eq("campaign_id", id).limit(100),
    ]);
    // Best only orders the ads; without it the copy still works.
    if (!results.error && !links.error) {
      best = bestCreativeId((results.data ?? []) as StoredAdResult[], (links.data ?? []) as { meta_ad_id: string; creative_id: string | null }[], campaign.destination);
    }
  }

  // #1174: a WhatsApp run without its own message sent the saved one; the next run copies it with Call off.
  const whatsapp = (draft ? draft.destination : campaign.destination) === "whatsapp" && !draft?.whatsappMessage;
  const { data: business } = whatsapp
    ? await supabase.from("businesses").select("whatsapp_template").eq("id", campaign.business_id).maybeSingle()
    : { data: null };
  const prefill = rerunPrefill({ campaign: { ...campaign, prepared: preparedAudienceForm(campaign.raw) }, draft, approvedIds: (approved ?? []).map((row) => row.id), bestCreativeId: best, savedMessage: business?.whatsapp_template });
  if ("error" in prefill) return apiError(prefill.error, 409);
  return NextResponse.json({ ok: true, prefill });
});
