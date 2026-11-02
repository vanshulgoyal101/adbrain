import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { ownMedia, readVerifiedMedia } from "@/lib/media/store";
import { metaClientForBusiness } from "@/lib/meta/credentials";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureMetaMedia, metaMediaPort, type MetaMediaResult } from "@/services/meta-media";
import { signedMediaUrl, supabaseMetaMediaStore } from "@/services/meta-media-store";

export const runtime = "nodejs";
// A video start is at most two 15 s Graph calls (one 389 retry) plus one status read.
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };
const body = z.object({ retry: z.boolean().optional() }).strict();

type Refusal = Extract<MetaMediaResult, { status: "refused" }>["reason"];
const REFUSED: Record<Refusal, [number, string, string]> = {
  not_found: [404, "MEDIA_NOT_FOUND", "Photo not found."],
  not_ready: [409, "MEDIA_NOT_UPLOADED", "This file isn't ready yet."],
  bad_account: [409, "META_NOT_CONNECTED", "Connect Facebook to send your files to Meta."],
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
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError("Bad request.", 400);
  try {
    // RLS read proves the owner; the account is the business's own connection, never one the request names.
    const row = await ownMedia(session.client, (await params).id);
    const client = await metaClientForBusiness(row.business_id);
    if (!client) return refused("bad_account");
    const admin = createAdminClient() as unknown as SupabaseClient;
    const result = await ensureMetaMedia({
      store: supabaseMetaMediaStore(admin),
      meta: metaMediaPort(client),
      readBytes: () => readVerifiedMedia(admin, row),
      signedUrl: (asset) => signedMediaUrl(admin, asset),
    }, { businessId: row.business_id, assetId: row.id, retry: parsed.data.retry });
    if (result.status === "refused") return refused(result.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
