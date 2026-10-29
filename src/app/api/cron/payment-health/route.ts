import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import { getProductionPaymentConfig, ProductionPaymentError } from "@/lib/payments/production-config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const healthSchema = z.object({
  events7d: z.number().int().min(0),
  unprocessed: z.number().int().min(0),
  capturedWithoutEvent: z.number().int().min(0),
});

/**
 * Razorpay webhook health (#178): counts only, no identifiers. Called by
 * `.github/workflows/scheduled-jobs.yml`, which alerts when a capture has no
 * matching webhook event or an event stays unprocessed.
 */
export const GET = observeRoute("/api/cron/payment-health", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let accountId: string;
  try {
    accountId = getProductionPaymentConfig().accountId;
  } catch (error) {
    if (error instanceof ProductionPaymentError) return NextResponse.json({ ok: true, payments: "disabled" });
    throw error;
  }
  const { data, error } = await createAdminClient()
    .rpc("production_payment_webhook_health", { p_account_id: accountId })
    .abortSignal(AbortSignal.timeout(10_000));
  // #1583: captured ₹999 plan payments that settled no month (plan.payment_unmatched) need a refund.
  const unmatched = await createAdminClient().from("product_events").select("event_id", { count: "exact", head: true })
    .eq("name", "plan.payment_unmatched").gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .abortSignal(AbortSignal.timeout(10_000));
  const health = healthSchema.safeParse(data);
  if (error || !health.success || unmatched.error || typeof unmatched.count !== "number") {
    return NextResponse.json({ ok: false, error: "Payment health is unavailable." }, { status: 503 });
  }
  const planUnmatched7d = unmatched.count;
  return NextResponse.json({ ok: health.data.capturedWithoutEvent === 0 && health.data.unprocessed === 0 && planUnmatched7d === 0,
    payments: "live", ...health.data, planUnmatched7d });
}
