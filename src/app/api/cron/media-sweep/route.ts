import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { sweepMedia } from "@/lib/media/sweep";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/** #2644: daily clean-up of unfinished media uploads and stray upload-path objects; counts only. Called by the scheduled workflow. */
export const GET = observeRoute("/api/cron/media-sweep", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sweepMedia(createAdminClient());
  return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
}
