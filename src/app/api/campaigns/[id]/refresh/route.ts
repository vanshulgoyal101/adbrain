import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { summarizeInsights } from "@/lib/creative/summary";
import { metaClientFromEnv } from "@/lib/meta/client";
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

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  let insights;
  try {
    insights = await meta.getCampaignInsights(campaign.meta_campaign_id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
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

  return NextResponse.json({ result, summary, insights });
}
