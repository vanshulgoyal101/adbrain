import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import {
  MetaError,
  geoItemsToTargeting,
  splitAgeRange,
  type GeoTargeting,
} from "@/lib/meta/client";
import { metaClientForBusiness } from "@/lib/meta/credentials";
import {
  describeAudience,
  normalizeTargetingInput,
  type TargetingInput,
} from "@/lib/campaign/targeting";
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
    targeting?: TargetingInput;
    abTest?: boolean;
  } | null;

  const businessId = (body?.businessId ?? "").trim();
  const creativeIds = (
    Array.isArray(body?.creativeIds) ? body.creativeIds : []
  ).slice(0, 50);
  const dailyBudget = Number(body?.dailyBudget ?? 0);
  const leadFormId = (body?.leadFormId ?? "").trim();
  const name = (body?.name ?? "").trim() || "AdBrain campaign";
  const targeting = normalizeTargetingInput(body?.targeting);
  const abTest = body?.abTest === true;

  if (!businessId || !creativeIds.length || !leadFormId || dailyBudget <= 0) {
    return NextResponse.json(
      { error: "businessId, creativeIds, leadFormId, and dailyBudget are required" },
      { status: 400 },
    );
  }

  const meta = await metaClientForBusiness(businessId);
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
  let areaLabel = "India (nationwide)";
  try {
    // Location: use the user's picks in manual mode; otherwise resolve the
    // brand's service areas ("let AdBrain decide"). Excluded places always
    // honoured when provided.
    let location: GeoTargeting | undefined;
    let excludedLocation: GeoTargeting | undefined;

    if (targeting.locationMode === "manual" && targeting.included.length) {
      location = geoItemsToTargeting(targeting.included, targeting.radiusKm);
      areaLabel = targeting.included.map((i) => i.name).join(", ");
    } else if (business.locations?.length) {
      try {
        const resolved = await meta.resolveGeoTargeting(business.locations, {
          radiusKm: targeting.radiusKm,
        });
        if (resolved.matched.length) {
          location = resolved.targeting;
          areaLabel = resolved.matched.map((m) => m.label).join(", ");
        }
      } catch {
        // Fall back to nationwide on geo-resolution failure.
      }
    }

    if (targeting.excluded.length) {
      excludedLocation = geoItemsToTargeting(
        targeting.excluded,
        targeting.radiusKm,
      );
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
      excludedLocation,
      ageMin: targeting.ageMin,
      ageMax: targeting.ageMax,
      // Opt-in audience A/B: split the age range into two ad sets.
      variants: abTest
        ? splitAgeRange(targeting.ageMin ?? 25, targeting.ageMax ?? 60).map(
            (band) => ({
              label: band.label,
              ageMin: band.ageMin,
              ageMax: band.ageMax,
              location,
              excludedLocation,
            }),
          )
        : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof MetaError ? err.message : (err as Error).message },
      { status: 502 },
    );
  }

  const audienceLabel = describeAudience({
    areaLabel,
    excluded: targeting.excluded,
    ageMode: targeting.ageMode,
    ageMin: targeting.ageMin,
    ageMax: targeting.ageMax,
  });

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
        targeting: {
          area: areaLabel,
          included: targeting.included,
          excluded: targeting.excluded,
          radiusKm: targeting.radiusKm,
          ageMode: targeting.ageMode,
          ageMin: targeting.ageMin,
          ageMax: targeting.ageMax,
        },
      } as unknown as Json,
    })
    .select("*")
    .single();
  if (error) {
    return serverError("campaigns.create", error, "Could not save the campaign.");
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
      area: areaLabel,
      excluded: targeting.excluded.map((e) => e.name),
    },
  });

  return NextResponse.json({ campaign, meta: result, audience: audienceLabel });
}
