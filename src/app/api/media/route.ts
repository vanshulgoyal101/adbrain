import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession, ownsBusiness } from "@/lib/media/route-helpers";
import { MEDIA_VIDEO_MAX_BYTES, MEDIA_VIDEO_MAX_SECONDS } from "@/lib/media/rules";
import { listMedia, MEDIA_MONTHLY_LIMIT, mediaVideoEnabled, monthlyUploads } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** #1209, #748: the owner's library, newest first, with signed URLs and this month's upload counts (videos shown before the picker). */
export const GET = observeRoute("/api/media", "GET", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId") ?? "";
  const before = url.searchParams.get("before") ?? undefined;
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || (before && Number.isNaN(Date.parse(before)))) return apiError("Business not found", 400);
  if (!await ownsBusiness(session.client, businessId)) return apiError("Business not found", 404);
  try {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const videos = mediaVideoEnabled();
    const [page, used, videosUsed] = await Promise.all([
      listMedia(session.client, businessId, before),
      monthlyUploads(admin, businessId, "image"),
      videos ? monthlyUploads(admin, businessId, "video") : 0,
    ]);
    return NextResponse.json({
      ok: true, ...page,
      uploads: {
        used, limit: MEDIA_MONTHLY_LIMIT.image,
        videos: { enabled: videos, used: videosUsed, limit: MEDIA_MONTHLY_LIMIT.video, maxSeconds: MEDIA_VIDEO_MAX_SECONDS, maxBytes: MEDIA_VIDEO_MAX_BYTES },
      },
    });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
