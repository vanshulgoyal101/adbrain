import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { isInternalUser } from "@/lib/internal-accounts";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_LOOKUPS = 10;

/**
 * "Ask for Facebook access" requests (#692), read-only: outside owners who tapped it in the last
 * 7 days, one opaque key per person (the first 12 hex of sha256 of the user id). Public workflow
 * logs get the key and hours only, never ids, names or numbers; `.github/workflows/scheduled-jobs.yml`
 * opens one `waiting-owner` issue per key.
 */
export const GET = observeRoute("/api/cron/access-requests", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  // #725: the durable record (written before the page says "Request sent"), plus the older analytics beacon.
  const [audit, beacons] = await Promise.all([
    admin.from("audit_log").select("actor_id, created_at").eq("action", "meta.access_request")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(500).abortSignal(AbortSignal.timeout(10_000)),
    admin.from("product_events").select("user_id, created_at")
      .eq("name", "ui.action").eq("attributes->>action", "meta.access_request")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(500).abortSignal(AbortSignal.timeout(10_000)),
  ]);
  if (audit.error || beacons.error || !Array.isArray(audit.data) || !Array.isArray(beacons.data)) {
    return NextResponse.json({ ok: false, error: "Access requests are unavailable." }, { status: 503 });
  }
  const latest = new Map<string, string>();
  for (const [userId, at] of [
    ...(audit.data as Array<{ actor_id: string | null; created_at: string }>).map((row) => [row.actor_id, row.created_at] as const),
    ...(beacons.data as Array<{ user_id: string | null; created_at: string }>).map((row) => [row.user_id, row.created_at] as const),
  ]) {
    if (userId && (!latest.has(userId) || Date.parse(at) > Date.parse(latest.get(userId)!))) latest.set(userId, at);
  }
  // Newest first, and a bounded number of account lookups per run; older ones wait for the next run.
  // Listed team ids need no lookup (domain accounts still do).
  const outside = [...latest].filter(([id]) => !isInternalUser({ id }));
  const newest = outside.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, MAX_LOOKUPS);
  const requests: Array<{ key: string; hours: number }> = [];
  for (const [userId, at] of newest) {
    const { data: found, error: userError } = await admin.auth.admin.getUserById(userId);
    // Unknown means it can't be shown to be internal: tell the team rather than drop a lead.
    if (!userError && isInternalUser(found.user)) continue;
    requests.push({ key: createHash("sha256").update(userId).digest("hex").slice(0, 12),
      hours: Math.floor((Date.now() - Date.parse(at)) / 3_600_000) });
  }
  return NextResponse.json({ ok: true, requests, more: outside.length - newest.length });
}
