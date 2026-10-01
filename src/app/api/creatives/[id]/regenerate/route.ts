import { observeRoute, currentRequestId } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { generateOneVariant } from "@/lib/creative/generate";
import {
  persistCreativeImage,
  renderAndPersistDesign,
} from "@/lib/creative/persist";
import { NoLLMKeysError } from "@/lib/llm";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { getAngleByName, AD_ANGLES } from "@/lib/templates/ads";
import {
  configuredMonthlyTokenLimit,
  monthlyTokenUsage,
  persistLLMUsage,
} from "@/lib/llm/persist";
import {
  generationReceipt,
  savedGenerationSettings,
  variantUsageEvents,
  failedVariantUsage,
} from "@/lib/creative/receipt";
import { creativeReferences, recentCreativeCopy } from "@/lib/creative/references";
import { preferenceContext } from "@/lib/preferences/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = observeRoute("/api/creatives/[id]/regenerate", "POST", handlePOST);

async function handlePOST(
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

  const limited = await rateLimitResponse(`regenerate:${user.id}`, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const { data: creative } = await supabase
    .from("creatives")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!creative) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", creative.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const limit = configuredMonthlyTokenLimit();
  if (limit > 0) {
    const used = await monthlyTokenUsage(business.id);
    if (used === null)
      return NextResponse.json(
        { error: "AI usage limits could not be verified." },
        { status: 503 },
      );
    if (used >= limit)
      return NextResponse.json(
        { error: "This business has reached its monthly AI generation limit." },
        { status: 429 },
      );
  }
  const { error: schemaError } = await supabase
    .from("creatives")
    .select("generation")
    .limit(0);
  if (schemaError)
    return NextResponse.json(
      { error: "Creative generation needs its database migration." },
      { status: 503 },
    );

  const attemptId = currentRequestId();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Regeneration admission is unavailable. No generation was started." }, { status: 503 });
  }
  const { data: claim, error: claimError } = await admin.rpc("creative_regeneration_claim", {
    p_creative_id: id, p_business_id: business.id, p_user_id: user.id, p_attempt_id: attemptId,
  });
  if (claimError || !claim)
    return NextResponse.json({ error: "Regeneration admission is unavailable. No generation was started." }, { status: 503 });
  if (claim.action === "missing") return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  if (claim.action === "busy")
    return NextResponse.json({ error: claim.status === "unresolved"
      ? "Previous paid regeneration needs review before retrying."
      : "Regeneration is already in progress. Refresh this creative before trying again." }, { status: 409 });
  if (claim.action !== "start")
    return NextResponse.json({ error: "Regeneration admission is unavailable. No generation was started." }, { status: 503 });

  let paidAttemptStarted = false;
  let unresolved = false;
  let response: NextResponse;
  try {
    const [instructions, referenceImages, recentCopy] = await Promise.all([
      getActiveInstructionsText(business.id),
      creativeReferences(supabase, business.id),
      recentCreativeCopy(supabase, business.id),
    ]);
    const settings = savedGenerationSettings(creative.generation);
    const advisoryPreferences = await preferenceContext(business.id, "creative", [creative.brief, instructions].filter(Boolean).join("\n")).catch(() => "");
    paidAttemptStarted = true;
    const variant = await generateOneVariant(
      business,
      creative.brief,
      angle,
      instructions,
      settings.language ?? undefined,
      settings.format,
      referenceImages,
      undefined,
      [{ headline: creative.headline ?? "", primary_text: creative.primary_text ?? "" }, ...recentCopy].slice(0, 12),
      advisoryPreferences,
      settings.sourceFacts,
    );
    const recorded = await persistLLMUsage(
      variantUsageEvents(variant, {
        businessId: business.id,
        userId: user.id,
        route: "creatives.regenerate",
        requestId: currentRequestId(),
      }),
    );
    if (!recorded) throw new Error("Regeneration usage could not be recorded");

    const photoUrl = await persistCreativeImage(
      supabase,
      business.id,
      creative.variant_group ?? id,
      angle.id,
      variant.imageUrl,
    );
    const imageUrl = await renderAndPersistDesign(
      supabase,
      business.id,
      creative.variant_group ?? id,
      angle.id,
      variant.design,
      photoUrl,
      variant.imageUrl,
    );

    const { data: updated, error } = await supabase
      .from("creatives")
      .update({
        angle: variant.angleName,
        image_url: imageUrl,
        headline: variant.headline,
        primary_text: variant.primaryText,
        cta: variant.cta,
        status: "draft",
        generation: generationReceipt(
          variant,
          settings.language ?? undefined,
          referenceImages,
          settings.sourceFacts,
        ),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !updated) {
      unresolved = true;
      response = serverError(
        "creative.regenerate",
        error ?? new Error("Creative update returned no row"),
        "Could not update creative.",
      );
    } else {
      await logEvent({
        businessId: business.id,
        action: "creative.regenerate",
        entityType: "creative",
        entityId: id,
        reason: creative.brief,
        details: { angle: variant.angleName },
      });
      response = NextResponse.json({ creative: updated });
    }
  } catch (err) {
    unresolved = paidAttemptStarted && !(err instanceof NoLLMKeysError);
    try {
      await persistLLMUsage(failedVariantUsage(err, {
        businessId: business.id,
        userId: user.id,
        route: "creatives.regenerate",
        requestId: attemptId,
      }));
    } catch {
      unresolved = paidAttemptStarted;
    }
    if (err instanceof NoLLMKeysError)
      response = NextResponse.json({ error: err.message }, { status: 400 });
    else response = NextResponse.json(
      {
        error: "Regeneration could not be completed. Refresh the creative before trying again.",
      },
      { status: 502 },
    );
  }
  const { data: settled, error: settleError } = await admin.rpc("creative_regeneration_finish", {
    p_creative_id: id, p_business_id: business.id, p_user_id: user.id,
    p_attempt_id: attemptId, p_unresolved: unresolved,
  });
  if (settleError || settled?.status !== (unresolved ? "unresolved" : "released"))
    return NextResponse.json({ error: "Regeneration state could not be confirmed. Check the creative before trying again." }, { status: 503 });
  return response;
}
