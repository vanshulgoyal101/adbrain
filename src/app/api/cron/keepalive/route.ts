import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Keeps the Supabase project awake.
 *
 * Free-tier projects auto-pause after ~7 days without activity, and a paused
 * project stops resolving in DNS entirely — which takes down auth and every
 * query (users see a browser security warning rather than a login screen).
 * A daily authenticated read is enough to count as activity.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = observeRoute("/api/cron/keepalive", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  if (error) {
    // Surface it so a failing keep-alive is visible in Vercel's cron log.
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 502 },
    );
  }
  if (process.env.PRODUCT_LOGGING_DATABASE_ENABLED === "true") {
    try {
      const { data, error: retentionError } = await createAdminClient().rpc("prune_product_events", {}).abortSignal(AbortSignal.timeout(5_000));
      if (retentionError) throw new Error("Retention failed");
      recordProductEvent({ kind: "system", name: "telemetry.retention", outcome: "success", attributes: { count: data ?? 0 } });
    } catch {
      recordProductEvent({ kind: "system", name: "telemetry.retention", outcome: "failed", attributes: { errorCode: "RETENTION_FAILED" } });
      return NextResponse.json({ ok: false, error: "Log retention could not be completed." }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
