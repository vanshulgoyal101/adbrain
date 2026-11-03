import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { ownWordsRequestSchema, saveOwnWordsAds } from "@/lib/creative/own-words";
import { pickedMedia } from "@/lib/media/ad-photos";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { mediaViews } from "@/lib/media/store";
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
  const { data: business } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle();
  if (!business) return apiError("Business not found.", 404);

  let photoUrls: Map<string, string>;
  try {
    const rows = await pickedMedia(session.client, businessId, items.map((item) => item.mediaId));
    const views = await mediaViews(createAdminClient() as unknown as SupabaseClient, rows);
    photoUrls = new Map(views.flatMap((view) => view.url ? [[view.id, view.url] as const] : []));
  } catch (error) {
    return mediaErrorResponse(error);
  }
  if (photoUrls.size !== items.length) return apiError("Couldn't read the photo. Try again.", 503);

  const instructions = await getActiveInstructionsText(businessId).catch(() => "");
  const { variantGroup, ads, error } = await saveOwnWordsAds(supabase, {
    business: business as Business, items, photoUrls, instructions, requestId: currentRequestId(),
  });
  if (ads.length) {
    await logEvent({
      businessId, action: "creatives.own", entityType: "creative", entityId: ads[0].creative.id,
      details: { variantGroup, count: ads.length, failed: items.length - ads.length },
    });
  }
  if (error) console.error("[creatives.own]", error);
  if (error && !ads.length) return apiError("Couldn't save your ads. Try again.", 503);
  return NextResponse.json({
    variantGroup,
    creatives: ads.map((ad) => ad.creative),
    warnings: ads.map((ad) => ad.warnings),
    ...(error ? { failed: items.length - ads.length } : {}),
  });
});
