import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession, ownsBusiness } from "@/lib/media/route-helpers";
import { signUpload } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const body = z.object({
  businessId: z.uuid(),
  mime: z.string().max(40),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  name: z.string().max(200).optional(),
  rightsConfirmed: z.boolean().optional(),
}).strict();

/** #1209: a one-time upload URL for one photo into the private `media` bucket (the bytes go browser → Storage). */
export const POST = observeRoute("/api/media/sign", "POST", async (req: Request) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const limited = await rateLimitResponse(`media-sign:${session.user.id}`, { limit: 60, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Choose a photo to add.", 400);
  if (!await ownsBusiness(session.client, parsed.data.businessId)) return apiError("Business not found", 404);
  try {
    const result = await signUpload(createAdminClient() as unknown as SupabaseClient, {
      ...parsed.data, userId: session.user.id, userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
