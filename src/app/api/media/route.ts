import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession, ownsBusiness } from "@/lib/media/route-helpers";
import { MEDIA_MONTHLY_UPLOADS } from "@/lib/media/rules";
import { listMedia, monthlyUploads } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** #1209: the owner's photo library, newest first, with signed URLs and this month's upload count. */
export const GET = observeRoute("/api/media", "GET", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId") ?? "";
  const before = url.searchParams.get("before") ?? undefined;
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || (before && Number.isNaN(Date.parse(before)))) return apiError("Business not found", 400);
  if (!await ownsBusiness(session.client, businessId)) return apiError("Business not found", 404);
  try {
    const [page, used] = await Promise.all([
      listMedia(session.client, businessId, before),
      monthlyUploads(createAdminClient() as unknown as SupabaseClient, businessId),
    ]);
    return NextResponse.json({ ok: true, ...page, uploads: { used, limit: MEDIA_MONTHLY_UPLOADS } });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
