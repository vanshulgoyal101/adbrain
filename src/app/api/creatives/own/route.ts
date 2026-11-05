import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerError } from "@/i18n/request-locale";
import { apiError, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { brandFacts } from "@/lib/creative/brand-facts";
import { copyClaimWarnings } from "@/lib/creative/concept";
import { OwnWordsCopyError } from "@/lib/creative/own-words-validation";
import { ownWordsRequestSchema, OwnWordsOverlayUnavailableError, OwnWordsVideoOverlayError, saveOwnWordsAds, type OwnWordsPhoto } from "@/lib/creative/own-words";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { isMediaMime, isMediaVideoMime } from "@/lib/media/rules";
import { MediaError, mediaVideoEnabled, pickedOwnMedia, readVerifiedMedia } from "@/lib/media/store";
import { currentRequestId, observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import type { Business, Creative, Database } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** #780: draft ads from the owner's library media and his own words. No AI call. */
export const POST = observeRoute("/api/creatives/own", "POST", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`creatives-own:${session.user.id}`, { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const parsed = ownWordsRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(await ownerError("ownWordsInputInvalid"), 400);
  const { businessId, idempotencyKey, items } = parsed.data;
  const supabase = session.client as unknown as SupabaseClient<Database>;

  // RLS: only the owner's business.
  const { data: business, error: businessError } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle();
  if (businessError) return serverError("creatives.own.business", businessError, await ownerError("ownWordsSaveFailed"), 503);
  if (!business) return apiError(await ownerError("businessNotFound"), 404);

  let photos: Map<string, OwnWordsPhoto>;
  const admin = createAdminClient() as unknown as SupabaseClient<Database>;
  try {
    const rows = await pickedOwnMedia(session.client, businessId, items.map((item) => item.mediaId), mediaVideoEnabled());
    photos = new Map(await Promise.all(rows.map(async (row) => {
      const validMime = row.kind === "video" ? row.mime && isMediaVideoMime(row.mime) : row.mime && isMediaMime(row.mime);
      if (!validMime) throw new MediaError(409, "MEDIA_TYPE", "This media isn't supported. Add it again.");
      return [row.id, { bytes: await readVerifiedMedia(admin, row), contentType: row.mime, kind: row.kind }] as const;
    })));
  } catch (error) {
    if (error instanceof MediaError) return mediaErrorResponse(error);
    return serverError("creatives.own.media", error, await ownerError("ownWordsMediaUnavailable"), 503);
  }
  if (photos.size !== items.length) return apiError(await ownerError("ownWordsMediaUnavailable"), 503);

  let instructions: string;
  try {
    instructions = await getActiveInstructionsText(businessId);
  } catch (error) {
    return serverError("creatives.own.instructions", error, await ownerError("ownWordsInstructionsUnavailable"), 503);
  }
  const variantGroup = idempotencyKey ?? crypto.randomUUID();
  const requestHash = createHash("sha256").update(JSON.stringify([
    businessId,
    items.map(({ mediaId, headline, primary_text, description, cta, offer }) => [mediaId, headline, primary_text, description, cta, offer]),
  ])).digest("hex");
  if (idempotencyKey) {
    const { data: admission, error: admissionError } = await admin.rpc("creative_generation_admit", {
      p_business_id: businessId, p_user_id: session.user.id, p_generation_id: idempotencyKey,
      p_request_hash: requestHash, p_expected_count: items.length, p_reserved_tokens: 1,
      p_image_floor_tokens: 0, p_monthly_limit: 0,
    });
    if (admissionError || !admission) return serverError("creatives.own.admit", admissionError ?? new Error("No admission result"), await ownerError("ownWordsSaveFailed"), 503);
    if (admission.action === "missing") return apiError(await ownerError("businessNotFound"), 404);
    if (admission.action === "conflict") return apiError(await ownerError("ownWordsIdempotencyConflict"), 409);
    if (admission.action === "quota") return apiError(await ownerError("ownWordsSaveFailed"), 429);

    if (admission.action === "recover") {
      const { data: existing, error: existingError } = await supabase.from("creatives").select("*")
        .eq("business_id", businessId).eq("variant_group", idempotencyKey);
      if (existingError) return serverError("creatives.own.replay", existingError, await ownerError("ownWordsSaveFailed"), 503);
      const creatives = (existing ?? []) as Creative[];
      const byMediaId = new Map(creatives.map((creative) => [creative.media_asset_id, creative]));
      const ordered = items.flatMap((item) => byMediaId.has(item.mediaId) ? [byMediaId.get(item.mediaId)!] : []);
      if (admission.status === "failed" && !ordered.length) {
        return NextResponse.json({ error: await ownerError("ownWordsBatchFailed"), code: "OWN_WORDS_BATCH_FAILED" }, { status: 503 });
      }
      if (ordered.length === items.length || admission.status === "partial") {
        return NextResponse.json({
          variantGroup, creatives: ordered,
          warnings: items.flatMap((item) => {
            const creative = byMediaId.get(item.mediaId);
            return creative ? [copyClaimWarnings({
              headline: item.headline, primary_text: item.primary_text, description: item.description,
            }, brandFacts(business as Business, instructions), business.vertical, { ownPicture: true })] : [];
          }),
          ...(ordered.length < items.length ? { failed: items.length - ordered.length } : {}),
        });
      }
      if (admission.status === "processing") {
        return NextResponse.json({ variantGroup, status: "processing", creatives: ordered }, { status: 202 });
      }
      return apiError(await ownerError("ownWordsBatchFailed"), 503);
    }
    if (admission.action !== "start") return apiError(await ownerError("ownWordsSaveFailed"), 503);
  }

  const { variantGroup: savedGroup, ads, error } = await saveOwnWordsAds(supabase, {
    business: business as Business, items, photos, instructions, requestId: currentRequestId(), variantGroup,
  });
  if (idempotencyKey) {
    const { data: progress, error: progressError } = await admin.rpc("creative_generation_progress", {
      p_business_id: businessId, p_user_id: session.user.id, p_generation_id: idempotencyKey,
      p_accounted_tokens: 0, p_complete: true, p_uncertain: false, p_failed: Boolean(error && !ads.length),
    });
    if (progressError || !progress || progress.status === "unknown") {
      return serverError("creatives.own.progress", progressError ?? new Error("No progress result"), await ownerError("ownWordsSaveFailed"), 503);
    }
  }
  if (ads.length) {
    await logEvent({
      businessId, action: "creatives.own", entityType: "creative", entityId: ads[0].creative.id,
      details: { variantGroup: savedGroup, count: ads.length, failed: items.length - ads.length },
    });
  }
  if (error instanceof OwnWordsCopyError) return NextResponse.json({ error: error.message, code: error.code, index: error.index, field: error.field }, { status: 422 });
  if (error instanceof OwnWordsOverlayUnavailableError) return NextResponse.json({ error: await ownerError("ownWordsOverlayUnavailable"), code: error.code }, { status: 503 });
  if (error instanceof OwnWordsVideoOverlayError) return NextResponse.json({ error: await ownerError("ownWordsVideoOverlay"), code: error.code }, { status: 422 });
  if (error) console.error("[creatives.own]", error);
  if (error && !ads.length) return apiError(await ownerError("ownWordsSaveFailed"), 503);
  return NextResponse.json({
    variantGroup: savedGroup,
    creatives: ads.map((ad) => ad.creative),
    warnings: ads.map((ad) => ad.warnings),
    ...(error ? { failed: items.length - ads.length } : {}),
  });
});
