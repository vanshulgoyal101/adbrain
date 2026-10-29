import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePayLink, isPayable, isPlanBillingEnabled, readPlan } from "@/lib/plan/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * #718 slice 2: once a day, each live own-account business whose month ends within 7 days (or is unpaid) gets that
 * month's Payment Link, so Razorpay's SMS/email reminders start on time. One link per month (ensurePayLink); a
 * business that fails is retried tomorrow and never stops the rest. Off while PLAN_BILLING_ENABLED is unset.
 */
export const GET = observeRoute("/api/cron/plan-links", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlanBillingEnabled()) return NextResponse.json({ ok: true, enabled: false, checked: 0, created: 0, failed: 0 });
  const { data, error } = await createAdminClient().from("campaigns").select("business_id").not("launched_at", "is", null).limit(5000);
  if (error) return NextResponse.json({ ok: false, error: "Campaigns are unavailable." }, { status: 503 });
  const businessIds = [...new Set((data ?? []).map((row) => row.business_id as string))];
  let created = 0, failed = 0;
  for (const businessId of businessIds) {
    try {
      const plan = await readPlan(businessId);
      if (!isPayable(plan.status) || plan.payUrl) continue;
      await ensurePayLink(businessId);
      created += 1;
    } catch {
      failed += 1;
    }
  }
  return NextResponse.json({ ok: failed === 0, enabled: true, checked: businessIds.length, created, failed });
}
