import { NextResponse } from "next/server";
import { friendlyMetaError } from "@/lib/meta/client";
import { logEvent } from "@/lib/audit";
import { summarizeInsights } from "@/lib/creative/summary";
import { enforceAutoPause } from "@/lib/campaign/spend-enforce";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
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

  let insights;
  try {
    const context = await requireOwnedBusiness(campaign.business_id);
    insights = await withMetaConnection(
      context,
      {
        purpose: "read_insights",
        binding: {
          adAccountId: storedBinding.metaAdAccountId,
          pageId: storedBinding.metaPageId,
        },
        expectedGeneration: storedBinding.metaConnectionGeneration,
      },
      (meta) => meta.getCampaignInsights(campaign.meta_campaign_id!),
    );
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "CONFLICT" ? 409 : 400 });
    }
    return NextResponse.json({ error: friendlyMetaError(err, "Could not refresh campaign results.") }, { status: 502 });
  }

  const { data: result } = await supabase
    .from("campaign_results")
    .insert({
      campaign_id: id,
      impressions: insights.impressions,
      clicks: insights.clicks,
      leads: insights.leads,
      spend: insights.spend,
      cpl: insights.cpl,
    })
    .select("*")
    .single();

  const summary = await summarizeInsights(campaign.objective, insights);

  await logEvent({
    businessId: campaign.business_id,
    action: "campaign.refresh",
    entityType: "campaign",
    entityId: id,
    metaObjectId: campaign.meta_campaign_id,
    details: { ...insights },
  });

  // Fresh spend arrived — enforce the weekly cap if auto-pause is on.
  const autoPaused = await enforceAutoPause(campaign.business_id);

  return NextResponse.json({ result, summary, insights, autoPaused });
}
