import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { ownWordsRequestSchema, OwnWordsOverlayUnavailableError, saveOwnWordsAds, type OwnWordsPhoto } from "@/lib/creative/own-words";
import { OwnWordsCopyError } from "@/lib/creative/own-words-validation";
import { pickedMedia } from "@/lib/media/ad-photos";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { isMediaMime } from "@/lib/media/rules";
import { MediaError, readVerifiedMedia } from "@/lib/media/store";
import { currentRequestId, observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import type { Business, Database } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** #780 slice 2b: draft ads from the owner's library photos and his own words. No AI call. */
export const POST = observeRoute("/api/creatives/own", "POST", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`creatives-own:${session.user.id}`, { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const parsed = ownWordsRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Each ad needs a photo, a headline (up to 40 characters), main text and a button.", 400);
  const { businessId, items } = parsed.data;
  const supabase = session.client as unknown as SupabaseClient<Database>;

  // RLS: only the owner's business.
  const { data: business, error: businessError } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle();
  if (businessError) return serverError("creatives.own.business", businessError, "Couldn't load your Brand. Try again.", 503);
  if (!business) return apiError("Business not found.", 404);

  let photos: Map<string, OwnWordsPhoto>;
  try {
    const rows = await pickedMedia(session.client, businessId, items.map((item) => item.mediaId));
    const admin = createAdminClient() as unknown as SupabaseClient;
    photos = new Map(await Promise.all(rows.map(async (row) => {
      if (!row.mime || !isMediaMime(row.mime)) throw new MediaError(409, "MEDIA_TYPE", "This photo isn't supported. Add it again.");
      return [row.id, { bytes: await readVerifiedMedia(admin, row), contentType: row.mime }] as const;
    })));
  } catch (error) {
    if (error instanceof MediaError) return mediaErrorResponse(error);
    return serverError("creatives.own.photo", error, "Couldn't read the photo. Try again.", 503);
  }
  if (photos.size !== items.length) return apiError("Couldn't read the photo. Try again.", 503);

  let instructions: string;
  try {
    instructions = await getActiveInstructionsText(businessId);
  } catch (error) {
    return serverError("creatives.own.instructions", error, "Couldn't load your Brand instructions. Try again.", 503);
  }
  const { variantGroup, ads, error } = await saveOwnWordsAds(supabase, {
    business: business as Business, items, photos, instructions, requestId: currentRequestId(),
  });
  if (ads.length) {
    await logEvent({
      businessId, action: "creatives.own", entityType: "creative", entityId: ads[0].creative.id,
      details: { variantGroup, count: ads.length, failed: items.length - ads.length },
    });
  }
  if (error instanceof OwnWordsCopyError) return NextResponse.json({ error: error.message, code: error.code, index: error.index, field: error.field }, { status: 422 });
  if (error instanceof OwnWordsOverlayUnavailableError) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  if (error) console.error("[creatives.own]", error);
  if (error && !ads.length) return apiError("Couldn't save your ads. Try again.", 503);
  return NextResponse.json({
    variantGroup,
    creatives: ads.map((ad) => ad.creative),
    warnings: ads.map((ad) => ad.warnings),
    ...(error ? { failed: items.length - ads.length } : {}),
  });
});
