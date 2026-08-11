import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { MetaError, metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    businessId?: string;
    creativeIds?: string[];
    dailyBudget?: number;
    leadFormId?: string;
    name?: string;
  } | null;

  const businessId = (body?.businessId ?? "").trim();
  const creativeIds = Array.isArray(body?.creativeIds) ? body.creativeIds : [];
  const dailyBudget = Number(body?.dailyBudget ?? 0);
  const leadFormId = (body?.leadFormId ?? "").trim();
  const name = (body?.name ?? "").trim() || "AdBrain campaign";

  if (!businessId || !creativeIds.length || !leadFormId || dailyBudget <= 0) {
    return NextResponse.json(
      { error: "businessId, creativeIds, leadFormId, and dailyBudget are required" },
      { status: 400 },
    );
  }

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: creatives } = await supabase
    .from("creatives")
    .select("*")
    .in("id", creativeIds)
    .eq("status", "approved");
  const usable = (creatives ?? []).filter((c) => c.image_url && c.headline);
  if (!usable.length) {
    return NextResponse.json(
      { error: "No approved creatives with an image were found" },
      { status: 400 },
    );
  }

  let result;
  try {
    // Target the brand's service areas when set; otherwise nationwide.
    let location;
    if (business.locations?.length) {
      try {
        location = (await meta.resolveGeoTargeting(business.locations)).targeting;
      } catch {
        // Fall back to nationwide on geo-resolution failure.
      }
    }

    result = await meta.createLeadCampaign({
      name,
      dailyBudgetRupees: dailyBudget,
      leadFormId,
      link: business.website || "https://facebook.com",
      creatives: usable.map((c) => ({
        imageUrl: c.image_url as string,
        headline: c.headline ?? "",
        message: c.primary_text ?? "",
        cta: c.cta,
      })),
      location,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof MetaError ? err.message : (err as Error).message },
      { status: 502 },
    );
  }

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      business_id: businessId,
      name,
      objective: "leads",
      daily_budget: dailyBudget,
      status: "paused",
      meta_campaign_id: result.campaignId,
      meta_adset_id: result.adSetId,
      meta_ad_ids: result.adIds,
      creative_ids: usable.map((c) => c.id),
      raw: {
        campaignId: result.campaignId,
        adSetId: result.adSetId,
        adIds: result.adIds,
        leadFormId,
        name,
        dailyBudget,
      } as unknown as Json,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    businessId,
    action: "campaign.create",
    entityType: "campaign",
    entityId: campaign.id,
    metaObjectId: result.campaignId,
    reason: `Created paused — ₹${dailyBudget}/day, ${usable.length} creative(s)`,
    details: {
      adSetId: result.adSetId,
      adIds: result.adIds,
      leadFormId,
      creativeIds: usable.map((c) => c.id),
      name,
    },
  });

  return NextResponse.json({ campaign, meta: result });
}
