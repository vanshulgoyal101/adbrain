import { NextResponse } from "next/server";
import { draftDtoSchema } from "@/lib/campaign/connect-contracts";
import { DRAFT_TTL_MS, MAX_ACTIVE_DRAFTS, draftRecordFromRow, draftRecordToDTO, prepareDraftCreate } from "@/lib/campaign/draft-store";
import { formatAnswers, runPlanner, type PlannerAnswer, type PlannerQuestion } from "@/lib/campaign/planner";
import { plannerPlanToDraftInput } from "@/lib/campaign/planner-draft";
import { ConnectionAccessError, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { friendlyMetaError } from "@/lib/meta/client";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import {
  getActiveInstructionsText,
  getApprovedCreatives,
  getPerformanceContext,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const limited = await rateLimitResponse(`plan:${user.id}`, {
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

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
  let actor;
  try {
    actor = await requireOwnedBusiness(business.id);
    leadForms = await withMetaConnection(
      actor,
      { purpose: "create_paused" },
      (meta) => meta.listLeadForms(),
    );
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 400 });
    }
    return NextResponse.json({ error: friendlyMetaError(err, "Could not load lead forms.") }, { status: 502 });
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
  const performance = await getPerformanceContext(business.id);

  let result;
  try {
    result = await runPlanner({
      brand: business,
      instructions,
      performance,
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
    return NextResponse.json({ error: friendlyMetaError(err, "Could not prepare the campaign plan.") }, { status: 502 });
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

  const draftResult = plannerPlanToDraftInput({
    businessId: business.id,
    goal,
    plan: result.plan,
    approvedCreativeIds: approved.map((creative) => creative.id),
    leadFormIds: leadForms.map((form) => form.id),
  });
  if (!draftResult.ok) {
    return NextResponse.json({
      ready: false,
      questions: [note(draftResult.error)],
    });
  }

  const now = new Date().toISOString();
  const plan = prepareDraftCreate({ actor, draftInput: draftResult.draft, now, ttlMs: DRAFT_TTL_MS });
  if ("ok" in plan) {
    return NextResponse.json({ error: plan.message }, { status: plan.code === "FORBIDDEN" ? 403 : 400 });
  }
  const { data: activeRows, error: countError } = await supabase
    .from("campaign_drafts")
    .select("id")
    .eq("business_id", actor.businessId)
    .eq("owner_id", actor.userId)
    .gt("expires_at", now);
  if (countError) return NextResponse.json({ error: "Draft storage is unavailable." }, { status: 503 });
  if ((activeRows ?? []).length >= MAX_ACTIVE_DRAFTS) {
    return NextResponse.json({ error: "Draft limit reached. Finish or remove an existing draft first." }, { status: 409 });
  }
  const { data: row, error } = await supabase
    .from("campaign_drafts")
    .insert({
      business_id: plan.businessId,
      owner_id: plan.ownerId,
      version: plan.version,
      input: plan.input as unknown as Json,
      expires_at: plan.expiresAt,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    })
    .select("*")
    .single();
  if (error || !row) return NextResponse.json({ error: "Draft storage is unavailable." }, { status: 503 });
  const draft = draftDtoSchema.parse(draftRecordToDTO(draftRecordFromRow(row)));
  return NextResponse.json({ ready: true, draft });
}
