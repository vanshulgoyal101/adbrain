import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { ownMedia } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaMediaResult } from "@/services/meta-media";
import { sendOwnMediaToMeta } from "@/services/meta-media-store";

export const runtime = "nodejs";
// A video start is two 15 s Graph calls (one 389 retry) plus a status read; a stuck claim's lookup can run past this,
// and a cut-off call stays `starting`, which the next call's name lookup settles without a second upload.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };
const body = z.object({ retry: z.boolean().optional() }).strict();

type Refusal = Extract<MetaMediaResult, { status: "refused" }>["reason"];
const REFUSED: Record<Refusal, [number, string, string]> = {
  not_found: [404, "MEDIA_NOT_FOUND", "Photo not found."],
  not_ready: [409, "MEDIA_NOT_UPLOADED", "This file isn't ready yet."],
  bad_account: [409, "META_NOT_CONNECTED", "Connect Facebook to send your files to Meta."],
  read_only: [403, "META_READ_ONLY", "The test account can only check and pause on this Meta ad account."],
};

function refused(reason: Refusal) {
  const [status, code, error] = REFUSED[reason];
  return NextResponse.json({ error, code }, { status });
}

/**
 * #749: sends one of the owner's files to the business's connected ad account (once per account) and reports where it
 * is: `ready` with Meta's image hash or video id, `processing` while Meta prepares a video (call again to poll), or
 * `error` with plain words. `retry` re-sends only a video that ended in `error`. Nothing here creates an ad or spends.
 */
export const POST = observeRoute("/api/media/[id]/meta", "POST", async (req: Request, { params }: Params) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  // Review polls each video about every 5 s while it is open.
  const limited = await rateLimitResponse(`media-meta:${session.user.id}`, { limit: 300, windowMs: 10 * 60_000 });
  if (limited) return limited;
  // An empty body means no retry; anything else must be valid JSON, so a garbled request never starts an upload.
  const text = await req.text();
  let payload: unknown = {};
  if (text.trim()) {
    try { payload = JSON.parse(text); } catch { return apiError("Bad request.", 400); }
  }
  const parsed = body.safeParse(payload);
  if (!parsed.success) return apiError("Bad request.", 400);
  try {
    // RLS read proves the owner; the account is the business's own connection, never one the request names.
    const row = await ownMedia(session.client, (await params).id);
    const result = await sendOwnMediaToMeta(createAdminClient() as unknown as SupabaseClient, row, parsed.data.retry);
    if (result.status === "refused") return refused(result.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
