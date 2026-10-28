import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adResultsEnabled, saveAdResults } from "@/lib/campaign/ad-results-store";
import { CampaignGoneError, friendlyMetaError, type AdResult, type AdReview } from "@/lib/meta/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/audit";
import { summarizeInsights } from "@/lib/creative/summary";
import { enforceAutoPauseWithStatus } from "@/lib/campaign/spend-enforce";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { ownerRefusal } from "@/lib/campaign/campaign-owner";
import { resultsStale } from "@/lib/campaign/results-freshness";
import { createClient } from "@/lib/supabase/server";
import { saveCampaign, saveCampaignResult } from "@/lib/campaign/trusted-write";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = observeRoute("/api/campaigns/[id]/refresh", "POST", handlePOST);

async function handlePOST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!campaign.meta_campaign_id) {
    return NextResponse.json(
      { error: "This campaign hasn't been launched to Meta yet" },
      { status: 400 },
    );
  }
  // #1138: a refresh can auto-pause on Meta (spend enforcement), so a duplicate row never reaches it.
  const refused = await ownerRefusal(campaign.business_id, campaign.meta_campaign_id);
  if (refused) return refused;

  const storedBinding = readStoredCampaignBinding(campaign);
  if (
    !storedBinding.metaAdAccountId ||
    !storedBinding.metaPageId ||
    storedBinding.metaConnectionGeneration === null
  ) {
    return NextResponse.json(
      { error: "This campaign needs account reconciliation before it can refresh." },
      { status: 409 },
    );
  }

  // #1003: a background refresh (card or Home opening) answers from the stored row while it's fresh, with no Meta call.
  if (new URL(req.url).searchParams.get("ifStale") === "1") {
    const { data: latest } = await supabase.from("campaign_results").select("*")
      .eq("campaign_id", id).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    if (latest && !resultsStale(latest.fetched_at)) return NextResponse.json({ result: latest, fresh: true });
  }

  let insights;
  let review: AdReview[] | null = null;
  let ads: AdResult[] | null = null;
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    ({ insights, review, ads } = await withMetaConnection(
      context,
      {
        purpose: "read_insights",
        binding: {
          adAccountId: storedBinding.metaAdAccountId,
          pageId: storedBinding.metaPageId,
        },
        expectedGeneration: storedBinding.metaConnectionGeneration,
      },
      async (meta) => ({
        insights: await meta.getCampaignInsights(campaign.meta_campaign_id!),
        review: await meta.readAdReview(campaign.meta_campaign_id!).catch(() => null),
        // #783: per-ad results ride along; a failure keeps the last stored rows.
        ads: adResultsEnabled() ? await meta.getAdResults(campaign.meta_campaign_id!).catch(() => null) : null,
      }),
    ));
  } catch (err) {
    if (err instanceof CampaignGoneError) {
      // #721: no spend can come from a deleted campaign; end it here so Manage stops treating it as paused.
      const raw = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? campaign.raw : {};
      const { data: ended } = await saveCampaign({ businessId: campaign.business_id, userId: user.id },
        { status: "completed", raw: { ...raw, metaStatus: err.metaStatus } }, id).catch(() => ({ data: null }));
      return NextResponse.json({ error: `${err.message} AdBrain moved it to ended campaigns.`, gone: err.metaStatus, campaign: ended ?? null }, { status: 410 });
    }
    const enforcement = await enforceAutoPauseWithStatus(campaign.business_id);
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message, autoPaused: enforcement.paused, protectionConfirmed: enforcement.confirmed }, { status: err.code === "CONFLICT" ? 409 : 400 });
    }
    return NextResponse.json({ error: friendlyMetaError(err, "Could not refresh campaign results."), autoPaused: enforcement.paused, protectionConfirmed: enforcement.confirmed }, { status: 502 });
  }

  const { data: result, error: resultError } = await saveCampaignResult(
    { businessId: campaign.business_id, userId: user.id }, {
      campaign_id: id,
      destination: insights.destination ?? "unknown",
      period_start: insights.periodStart ?? null,
      period_end: insights.periodEnd ?? null,
      impressions: insights.impressions,
      clicks: insights.clicks,
      leads: insights.leads,
      spend: insights.spend,
      cpl: insights.cpl,
      ...(insights.conversations !== undefined ? { conversations: insights.conversations, cost_per_conversation: insights.costPerConversation ?? null, whatsapp_opens: insights.whatsappOpens ?? null } : {}),
    }).catch(() => ({ data: null, error: new Error("Result storage unavailable.") }));

  if (resultError || !result) {
    return NextResponse.json({ error: "Could not save refreshed results. Retry the refresh.", protectionConfirmed: false }, { status: 503 });
  }

  if (ads) await saveAdResults(createAdminClient() as unknown as SupabaseClient, { businessId: campaign.business_id, campaignId: id, ads }).catch(() => false);

  const [summary, enforcement] = await Promise.all([
    summarizeInsights(campaign.name ?? "Your campaign", insights),
    enforceAutoPauseWithStatus(campaign.business_id),
    logEvent({
      businessId: campaign.business_id,
      action: "campaign.refresh",
      entityType: "campaign",
      entityId: id,
      metaObjectId: campaign.meta_campaign_id,
      details: { ...insights },
    }),
  ]);

  return NextResponse.json({ result, summary, insights, review, autoPaused: enforcement.paused, protectionConfirmed: enforcement.confirmed });
}
