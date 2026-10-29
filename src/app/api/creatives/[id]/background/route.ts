import { observeRoute, currentRequestId } from "@/lib/observability/logger";
import { applyMonthlyCostCap } from "@/lib/llm/cost-cap";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { backgroundImagePrompt, backgroundRequestSchema } from "@/lib/creative/background";
import { formatDimensions } from "@/lib/creative/design";
import { CreativeImageError, OWNER_PHOTO_PROVIDER } from "@/lib/creative/generate";
import { persistCreativeImage, renderAndPersistDesign } from "@/lib/creative/persist";
import { pictureDesign } from "@/lib/creative/picture-words";
import { creativeReferences } from "@/lib/creative/references";
import { failedVariantUsage, imageUsageEvents, savedGenerationSettings } from "@/lib/creative/receipt";
import { generateImage } from "@/lib/imageGen";
import type { ImageAttempt } from "@/lib/imageGen/types";
import { configuredMonthlyTokenLimit, monthlyTokenUsage, persistLLMUsage } from "@/lib/llm/persist";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AD_ANGLES, getAngleByName } from "@/lib/templates/ads";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = observeRoute("/api/creatives/[id]/background", "POST", handlePOST);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A new picture behind the same words (#280 slice 3). One paid image call, the
 * same admission claim as Regenerate, and the copy and overlay words are kept.
 */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = backgroundRequestSchema.safeParse(body);
  if (!parsed.success) {
    const tooLong = typeof (body as { instruction?: unknown } | null)?.instruction === "string" && (body as { instruction: string }).instruction.trim().length > 300;
    return NextResponse.json(
      { error: tooLong ? "Keep the description to 300 characters or fewer." : "Describe the background you want, for example \"rooftop at sunset\"." },
      { status: 400 },
    );
  }
  const instruction = "instruction" in parsed.data ? parsed.data.instruction : null;
  const ownerPhoto = "photoUrl" in parsed.data ? parsed.data.photoUrl : null;
  const photoFit = "photoUrl" in parsed.data ? parsed.data.fit : undefined;

  const limited = await rateLimitResponse(`regenerate:${user.id}`, { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;

  const { data: creative } = await supabase
    .from("creatives")
    .select("id, business_id, variant_group, angle, image_url, headline, primary_text, cta, generation")
    .eq("id", id)
    .maybeSingle();
  if (!creative) return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", creative.business_id)
    .maybeSingle();
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  if (ownerPhoto) {
    // Only the business's own product photos; never an arbitrary URL.
    const { data: asset } = await supabase
      .from("brand_assets")
      .select("url")
      .eq("business_id", business.id)
      .eq("type", "product_photo")
      .eq("url", ownerPhoto)
      .limit(1)
      .maybeSingle();
    if (!asset) return NextResponse.json({ error: "That photo isn't in your Brand assets." }, { status: 400 });
  }

  const limit = ownerPhoto ? 0 : configuredMonthlyTokenLimit(user);
  if (limit > 0) {
    const used = await monthlyTokenUsage(business.id);
    if (used === null) return NextResponse.json({ error: "AI usage limits could not be verified." }, { status: 503 });
    if (used >= limit)
      return NextResponse.json({ error: "This business has reached its monthly AI generation limit." }, { status: 429 });
  }
  // #1717: over the monthly AI cost cap, the new picture is free (text keeps the token cap).
  await applyMonthlyCostCap(business.id, user);

  const attemptId = currentRequestId();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Image admission is unavailable. No new background was started." }, { status: 503 });
  }
  // One paid job per ad at a time, shared with Regenerate.
  const { data: claim, error: claimError } = await admin.rpc("creative_regeneration_claim", {
    p_creative_id: id, p_business_id: business.id, p_user_id: user.id, p_attempt_id: attemptId,
  });
  if (claimError || !claim)
    return NextResponse.json({ error: "Image admission is unavailable. No new background was started." }, { status: 503 });
  if (claim.action === "missing") return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  if (claim.action === "busy")
    return NextResponse.json({ error: claim.status === "unresolved"
      ? "A previous paid change to this ad needs a check before trying again."
      : "This ad is already being changed. Refresh it before trying again." }, { status: 409 });
  if (claim.action !== "start")
    return NextResponse.json({ error: "Image admission is unavailable. No new background was started." }, { status: 503 });

  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const group = creative.variant_group ?? id;
  const usageContext = { businessId: business.id, userId: user.id, route: "creatives.background", requestId: attemptId, creativeId: id };
  let paidAttemptStarted = false;
  let unresolved = false;
  let response: NextResponse;
  try {
    const { format } = savedGenerationSettings(creative.generation);
    const dims = formatDimensions(format);
    const imageAttempts: ImageAttempt[] = [];
    let prompt = "[No image prompt: this ad uses the business's own photo from Brand assets.]";
    let image: { url: string; provider: string; model?: string; estimatedCostUsd?: number; latencyMs?: number; width?: number; height?: number;
      fallbackFrom?: string; providerRequestId?: string; providerFinalStatus?: "completed" | "failed" | "unknown" } =
      { url: ownerPhoto ?? "", provider: OWNER_PHOTO_PROVIDER, model: "brand_assets", estimatedCostUsd: 0 };
    if (!ownerPhoto) {
      const referenceImages = await creativeReferences(supabase, business.id);
      prompt = backgroundImagePrompt({
        generation: creative.generation, design: pictureDesign(creative, business), brand: business, format, instruction: instruction!, referenceImages,
      });
      paidAttemptStarted = true;
      image = await generateImage({
        prompt,
        width: dims.width,
        height: dims.height,
        referenceImages: referenceImages.slice(0, 3),
        onAttempt: (entry) => imageAttempts.push(entry),
      }).catch((error) => {
        throw new CreativeImageError(error, [], imageAttempts);
      });
    }
    const imageUsage = {
      provider: image.provider,
      model: image.model ?? image.provider,
      estimatedCostUsd: image.estimatedCostUsd,
      latencyMs: image.latencyMs,
      width: image.width ?? dims.width,
      height: image.height ?? dims.height,
      fallbackFrom: image.fallbackFrom,
      providerRequestId: image.providerRequestId,
      providerFinalStatus: image.providerFinalStatus,
    };
    if (!ownerPhoto) {
      const recorded = await persistLLMUsage(imageUsageEvents({ angleId: angle.id, imageUsage, imageAttempts }, usageContext));
      if (!recorded) throw new Error("Background usage could not be recorded");
    }

    // Re-read after the slow image call so text or picture words edited meanwhile are kept.
    const { data: fresh } = await supabase.from("creatives").select("generation").eq("id", id).maybeSingle();
    const latest = isRecord(fresh?.generation) ? fresh.generation : isRecord(creative.generation) ? creative.generation : {};
    // #1904: an owner photo keeps the fit the owner chose; a new AI picture is made for the frame, so no fit.
    const design = { ...pictureDesign({ ...creative, generation: latest as Json }, business), backgroundFit: photoFit };
    const photoUrl = await persistCreativeImage(supabase, business.id, group, angle.id, image.url);
    const imageUrl = await renderAndPersistDesign(supabase, business.id, group, angle.id, design, photoUrl, image.url);

    const generation = JSON.parse(JSON.stringify({
      ...latest,
      design: { ...design, backgroundUrl: undefined },
      photoUrl,
      imagePrompt: prompt,
      image: { ...imageUsage, estimatedCostUsd: imageUsage.estimatedCostUsd ?? null },
      imageAttempts,
      ownerPhoto,
      backgroundInstruction: instruction,
      backgroundChangedAt: new Date().toISOString(),
    })) as Json;
    const { data: updated, error } = await supabase
      .from("creatives")
      .update({ image_url: imageUrl, generation })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error || !updated) {
      // Paid and stored, but not attached to the ad: hold the claim for a check.
      unresolved = paidAttemptStarted;
      response = NextResponse.json({ error: "The new background was made but couldn't be saved to this ad. It needs a check before trying again." }, { status: 502 });
    } else {
      const { data: live } = await supabase
        .from("campaigns")
        .select("id")
        .eq("business_id", business.id)
        .contains("creative_ids", [id])
        .not("meta_campaign_id", "is", null)
        .limit(1);
      await logEvent({
        businessId: business.id,
        action: "creative.change_background",
        entityType: "creative",
        entityId: id,
        reason: instruction ?? "owner photo",
      });
      response = NextResponse.json({
        creative: updated,
        ...(live?.length ? { liveNotice: "This ad is live on Meta; your edit applies to new campaigns." } : {}),
      });
    }
  } catch (err) {
    // The provider said every attempt failed and we recorded them: the spend is known and nothing changed.
    const knownFailure = err instanceof CreativeImageError && err.imageAttempts.length > 0 &&
      err.imageAttempts.every((attempt) => attempt.status === "error" && attempt.providerFinalStatus === "failed");
    unresolved = paidAttemptStarted;
    try {
      const recorded = await persistLLMUsage(failedVariantUsage(err, usageContext));
      if (knownFailure && recorded) unresolved = false;
    } catch {
      unresolved = paidAttemptStarted;
    }
    response = NextResponse.json(
      {
        error: unresolved
          ? "The new background could not be finished. This attempt needs a check before the ad's picture can be changed again."
          : ownerPhoto
            ? "Couldn't use that photo. Your ad is unchanged; try another photo."
            : "Couldn't make a new background this time. Your ad is unchanged; try again.",
      },
      { status: 502 },
    );
  }
  const { data: settled, error: settleError } = await admin.rpc("creative_regeneration_finish", {
    p_creative_id: id, p_business_id: business.id, p_user_id: user.id,
    p_attempt_id: attemptId, p_unresolved: unresolved,
  });
  if (settleError || settled?.status !== (unresolved ? "unresolved" : "released"))
    return NextResponse.json({ error: "This change's state could not be confirmed. Check the ad before trying again." }, { status: 503 });
  return response;
}
