import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import { WORKFLOWS, isOverdue, type Workflow } from "./workflows";

export const runtime = "nodejs";

const API = "https://api.github.com/repos/vanshulgoyal101/adbrain/actions/workflows";

type Outcome = { workflow: string; lastRunMinutesAgo: number | null; dispatched: boolean; error?: string };

/**
 * Dispatcher for scheduled GitHub workflows (#2593): see ./workflows.ts. A failure is reported per workflow and
 * turns the call into a 503, so scheduler-health sees it; the token never leaves this route.
 */
export const GET = observeRoute("/api/cron/dispatch-workflows", "GET", handleGET);

async function handleGET(request: Request) {
  const env = getEnv();
  const secret = env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = env.GITHUB_DISPATCH_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "GITHUB_DISPATCH_TOKEN is not set." }, { status: 503 });

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const now = Date.now();
  const workflows = await Promise.all(WORKFLOWS.map((workflow) => dispatchIfOverdue(workflow, headers, now)));
  const ok = workflows.every(({ error }) => !error);
  return NextResponse.json({ ok, workflows }, { status: ok ? 200 : 503 });
}

async function dispatchIfOverdue(entry: Workflow, headers: Record<string, string>, now: number): Promise<Outcome> {
  const { workflow, everyMinutes } = entry;
  const outcome: Outcome = { workflow, lastRunMinutesAgo: null, dispatched: false };
  const runs = await fetch(`${API}/${workflow}/runs?per_page=1`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) })
    .catch(() => null);
  if (!runs?.ok) return { ...outcome, error: `Could not read runs (${runs?.status ?? "network"}).` };
  const body = await runs.json().catch(() => null) as { workflow_runs?: { created_at?: unknown }[] } | null;
  if (!body || !Array.isArray(body.workflow_runs)) return { ...outcome, error: "Could not read runs (bad reply)." };
  const createdAt = body.workflow_runs[0]?.created_at;
  const lastRunAt = typeof createdAt === "string" ? createdAt : null;
  if (lastRunAt && !Number.isNaN(Date.parse(lastRunAt))) {
    outcome.lastRunMinutesAgo = Math.max(0, Math.floor((now - Date.parse(lastRunAt)) / 60_000));
  }
  if (!isOverdue(everyMinutes, lastRunAt, now)) return outcome;

  const inputs = "inputs" in entry ? entry.inputs : undefined;
  const dispatch = await fetch(`${API}/${workflow}/dispatches`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify(inputs ? { ref: "main", inputs } : { ref: "main" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!dispatch?.ok) return { ...outcome, error: `Could not dispatch (${dispatch?.status ?? "network"}).` };
  return { ...outcome, dispatched: true };
}
