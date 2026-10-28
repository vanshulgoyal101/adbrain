import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { mediaErrorResponse, mediaSession } from "@/lib/media/route-helpers";
import { deleteMedia, ownMedia, updateMedia } from "@/lib/media/store";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const change = z.object({
  name: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
}).strict();

/** #1209: rename or tag one of the owner's photos. */
export const PATCH = observeRoute("/api/media/[id]", "PATCH", async (req: Request, { params }: Params) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Nothing to change.", 400);
  try {
    const row = await ownMedia(session.client, (await params).id);
    return NextResponse.json({ ok: true, asset: await updateMedia(createAdminClient() as unknown as SupabaseClient, row, parsed.data) });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});

/** #1209: delete one of the owner's photos (409 while a running campaign uses it). */
export const DELETE = observeRoute("/api/media/[id]", "DELETE", async (_req: Request, { params }: Params) => {
  const session = await mediaSession();
  if (session instanceof NextResponse) return session;
  try {
    const row = await ownMedia(session.client, (await params).id);
    await deleteMedia(createAdminClient() as unknown as SupabaseClient, row);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mediaErrorResponse(error);
  }
});
