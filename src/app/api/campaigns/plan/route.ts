import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import {
  formatAnswers,
  runPlanner,
  type PlannerAnswer,
  type PlannerQuestion,
} from "@/lib/campaign/planner";
import {
  MetaError,
  metaClientFromEnv,
  type GeoTargeting,
} from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveInstructionsText,
  getApprovedCreatives,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";
import type { Creative, Json } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

/** A non-answerable informational message rendered in the chat. */
const note = (text: string): PlannerQuestion => ({
  id: "note",
  question: text,
  type: "text",
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    goal?: string;
    answers?: PlannerAnswer[] | string;
  } | null;
  const goal = (body?.goal ?? "").trim();
  const rawAnswers = body?.answers;
  const answers = Array.isArray(rawAnswers)
    ? formatAnswers(rawAnswers) || undefined
    : typeof rawAnswers === "string"
      ? rawAnswers.trim() || undefined
      : undefined;
  if (!goal) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  const approved = await getApprovedCreatives(business.id);
  if (!approved.length) {
    return NextResponse.json({
      ready: false,
      questions: [
        note(
          "You don't have any approved creatives yet. Generate a batch in the Creative Studio and approve the ones you like, then come back.",
        ),
      ],
    });
  }

  let leadForms;
  try {
    leadForms = await meta.listLeadForms();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
  if (!leadForms.length) {
    return NextResponse.json({
      ready: false,
      questions: [
        note(
          "I couldn't find an active lead form on your Facebook Page. Create one in Meta (or make sure the app has access), then try again.",
        ),
      ],
    });
  }

  const instructions = await getActiveInstructionsText(business.id);

  let result;
  try {
    result = await runPlanner({
      brand: business,
      instructions,
      approved: approved.map((c) => ({
        id: c.id,
        angle: c.angle,
        headline: c.headline,
      })),
      leadForms: leadForms.map((f) => ({ id: f.id, name: f.name })),
      goal,
      answers,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  if (!result.ready || !result.plan) {
    return NextResponse.json({
      ready: false,
      questions: result.questions?.length
        ? result.questions
        : [
            note(
              "Could you tell me your daily budget and which area or offer to focus on?",
            ),
          ],
    });
  }

  // Validate the AI's plan against reality — never trust invented IDs.
  const approvedById = new Map(approved.map((c) => [c.id, c]));
  let chosenIds = result.plan.creative_ids.filter((id) => approvedById.has(id));
  if (!chosenIds.length) chosenIds = approved.map((c) => c.id);
  const usable = chosenIds
    .map((id) => approvedById.get(id))
    .filter(
      (c): c is Creative => !!c && !!c.image_url && !!c.headline,
    );
  if (!usable.length) {
    return NextResponse.json({
      ready: false,
      questions: [
        note(
          "The chosen creatives are missing images. Regenerate them in the Studio, then try again.",
        ),
      ],
    });
  }

  const leadForm =
    leadForms.find((f) => f.id === result.plan!.lead_form_id) ?? leadForms[0];
  const budget = clamp(Math.round(result.plan.daily_budget_rupees || 0), 100, 100000);
  const ageMin = clamp(Math.round(result.plan.age_min || 25), 18, 65);
  const ageMax = clamp(Math.round(result.plan.age_max || 55), ageMin, 65);
  const name = (result.plan.name || `${business.name} — AI leads`).slice(0, 120);

  // Resolve target areas: the planner's chosen locations, else the brand's areas.
  const planLocations = Array.isArray(result.plan.locations)
    ? result.plan.locations.filter((s): s is string => typeof s === "string")
    : [];
  const targetNames = planLocations.length
    ? planLocations
    : business.locations ?? [];
  let location: GeoTargeting | undefined;
  let areaLabel = "India (nationwide)";
  if (targetNames.length) {
    try {
      const resolved = await meta.resolveGeoTargeting(targetNames);
      if (resolved.matched.length) {
        location = resolved.targeting;
        areaLabel = resolved.matched.map((m) => m.label).join(", ");
      }
    } catch {
      // Fall back to nationwide if geo resolution fails.
    }
  }

  // Resolve nearby areas to exclude (so the business avoids out-of-area calls).
  const excludeNames = Array.isArray(result.plan.excluded_locations)
    ? result.plan.excluded_locations.filter((s): s is string => typeof s === "string")
    : [];
  let excludedLocation: GeoTargeting | undefined;
  let excludeLabel = "";
  if (excludeNames.length) {
    try {
      const resolved = await meta.resolveGeoTargeting(excludeNames);
      if (resolved.matched.length) {
        excludedLocation = resolved.targeting;
        excludeLabel = resolved.matched.map((m) => m.label).join(", ");
      }
    } catch {
      // Exclusions are best-effort.
    }
  }

  let created;
  try {
    created = await meta.createLeadCampaign({
      name,
      dailyBudgetRupees: budget,
      leadFormId: leadForm.id,
      link: business.website || "https://facebook.com",
      creatives: usable.map((c) => ({
        imageUrl: c.image_url as string,
        headline: c.headline ?? "",
        message: c.primary_text ?? "",
        cta: c.cta,
      })),
      ageMin,
      ageMax,
      location,
      excludedLocation,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof MetaError ? err.message : (err as Error).message },
      { status: 502 },
    );
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .insert({
      business_id: business.id,
      name,
      objective: "leads",
      daily_budget: budget,
      status: "paused",
      meta_campaign_id: created.campaignId,
      meta_adset_id: created.adSetId,
      meta_ad_ids: created.adIds,
      creative_ids: usable.map((c) => c.id),
      raw: { plan: result.plan, created } as unknown as Json,
    })
    .select("*")
    .single();

  await logEvent({
    businessId: business.id,
    action: "campaign.ai_create",
    entityType: "campaign",
    entityId: campaign?.id,
    metaObjectId: created.campaignId,
    reason: result.plan.rationale,
    details: {
      budget,
      leadFormId: leadForm.id,
      creativeIds: usable.map((c) => c.id),
      ageMin,
      ageMax,
      locations: targetNames,
      area: areaLabel,
      excluded: excludeNames,
    },
  });

  const summary = [
    `Created a paused Leads campaign “${name}”.`,
    `Budget: ${formatCurrency(budget)}/day.`,
    `Creatives: ${usable.length}${
      usable.map((c) => c.angle).filter(Boolean).length
        ? ` (${usable.map((c) => c.angle).filter(Boolean).join(", ")})`
        : ""
    }.`,
    `Lead form: “${leadForm.name}”.`,
    `Audience: ${areaLabel} (residents only), ages ${ageMin}–${ageMax}.`,
    excludeLabel ? `Excluded: ${excludeLabel}.` : "",
    result.plan.rationale ? `Why: ${result.plan.rationale}` : "",
    "It's paused — review and activate it in Meta Ads Manager when you're ready to spend.",
  ]
    .filter(Boolean)
    .join(" ");

  return NextResponse.json({ ready: true, created: true, summary, campaign });
}
