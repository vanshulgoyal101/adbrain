import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { finalizeUpload, ownMedia } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/** #1209: after the browser's upload, re-read the stored photo and list it, or remove it with the reason. */
export const POST = observeRoute("/api/media/finalize", "POST", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`media-finalize:${session.user.id}`, { limit: 60, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Photo not found.", 400);
  try {
    // RLS read proves the owner; the service role does the write.
    const row = await ownMedia(session.client, parsed.data.id);
    return NextResponse.json({ ok: true, asset: await finalizeUpload(createAdminClient() as unknown as SupabaseClient, row) });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
