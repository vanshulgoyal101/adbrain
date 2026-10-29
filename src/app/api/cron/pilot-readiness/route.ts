import { NextResponse } from "next/server";
import { pilotReadiness } from "@/lib/config/pilot-readiness";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";

export const runtime = "nodejs";

/**
 * Pilot settings check (#1875): names of missing or switched-off production
 * settings, never values. Called by `.github/workflows/scheduled-jobs.yml`,
 * which opens one DevOps issue while anything is missing.
 */
export const GET = observeRoute("/api/cron/pilot-readiness", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(pilotReadiness(process.env));
}
