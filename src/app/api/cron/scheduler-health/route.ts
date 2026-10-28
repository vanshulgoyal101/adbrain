import { NextResponse } from "next/server";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthError } from "@/lib/security/cron-auth";

export const runtime = "nodejs";

/** The jobs Supabase pg_cron calls (#274; db/migrations/20261024_scheduler_pg_cron.sql) and how often each must succeed. */
const JOBS = [
  { job: "enforce-spend", everyMinutes: 15 },
  { job: "sync-leads", everyMinutes: 15 },
  // Called every 15 min, but a single failing campaign makes a call 503; an hour keeps that from paging.
  { job: "refresh-results", everyMinutes: 60 },
] as const;
const LOOKBACK_MS = 24 * 3_600_000;

/**
 * Scheduler watchdog (#274): each job's last run and last successful run, from the
 * `http.request` events every cron route already logs, whichever scheduler called it.
 * A job is overdue after twice its interval without a successful run. Called first by
 * `.github/workflows/scheduled-jobs.yml`, which opens one issue per overdue job.
 */
export const GET = observeRoute("/api/cron/scheduler-health", "GET", handleGET);

async function handleGET(request: Request) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;
  const now = Date.now();
  const { data, error } = await createAdminClient().from("product_events")
    .select("created_at, outcome, route:attributes->>route")
    .eq("name", "http.request")
    .in("attributes->>route", JOBS.map(({ job }) => `/api/cron/${job}`))
    .gte("created_at", new Date(now - LOOKBACK_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000)
    .abortSignal(AbortSignal.timeout(10_000));
  if (error || !Array.isArray(data)) {
    return NextResponse.json({ ok: false, error: "Scheduler health is unavailable." }, { status: 503 });
  }
  const rows = data as Array<{ created_at: string; outcome: string; route: string | null }>;
  const minutesAgo = (row: { created_at: string } | undefined) =>
    row ? Math.max(0, Math.floor((now - Date.parse(row.created_at)) / 60_000)) : null;
  const jobs = JOBS.map(({ job, everyMinutes }) => {
    // Rejected calls (401/404) never reached the job.
    const runs = rows.filter(row => row.route === `/api/cron/${job}` && row.outcome !== "rejected");
    const lastSuccessMinutesAgo = minutesAgo(runs.find(row => row.outcome === "success"));
    return {
      job, everyMinutes,
      lastRunMinutesAgo: minutesAgo(runs[0]),
      lastSuccessMinutesAgo,
      overdue: lastSuccessMinutesAgo === null || lastSuccessMinutesAgo > 2 * everyMinutes,
    };
  });
  return NextResponse.json({ ok: jobs.every(({ overdue }) => !overdue), jobs });
}
