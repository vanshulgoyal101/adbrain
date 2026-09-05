import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaClientForBusiness } from "@/lib/meta/credentials";
import {
  campaignsToAutoPause,
  type CampaignSpend,
  type SpendLimits,
} from "@/lib/campaign/spend";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runaway-spend backstop.
 *
 * The per-campaign refresh route only enforces the weekly cap while a user is
 * looking at the app; Meta, however, spends around the clock. This cron sweeps
 * every business that has auto-pause on with a positive weekly cap and pauses
 * active campaigns whose tracked spend has reached the cap — even if nobody has
 * opened the dashboard. It runs under the service-role client (no user session)
 * and reuses the pure `campaignsToAutoPause` decision so the rule lives in one
 * place.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Only businesses that opted into auto-pause with a real cap.
  const { data: limitRows, error: limitsErr } = await admin
    .from("spend_limits")
    .select("business_id, weekly_cap_rupees, alert_pct, auto_pause")
    .eq("auto_pause", true)
    .gt("weekly_cap_rupees", 0);
  if (limitsErr) {
    return NextResponse.json(
      { ok: false, error: limitsErr.message },
      { status: 502 },
    );
  }

  const swept: Array<{ businessId: string; paused: string[] }> = [];

  for (const row of limitRows ?? []) {
    const businessId = row.business_id;
    const limits: SpendLimits = {
      weeklyCapRupees: row.weekly_cap_rupees,
      alertPct: row.alert_pct,
      autoPause: row.auto_pause,
    };

    const { data: campaigns } = await admin
      .from("campaigns")
      .select("id, status, daily_budget, meta_campaign_id")
      .eq("business_id", businessId);
    if (!campaigns?.length) continue;

    // Latest tracked spend per campaign (results are newest-first).
    const { data: results } = await admin
      .from("campaign_results")
      .select("campaign_id, spend, fetched_at")
      .in(
        "campaign_id",
        campaigns.map((c) => c.id),
      )
      .order("fetched_at", { ascending: false });
    const latestSpend = new Map<string, number>();
    for (const r of results ?? []) {
      if (!latestSpend.has(r.campaign_id)) {
        latestSpend.set(r.campaign_id, r.spend ?? 0);
      }
    }

    const spends: CampaignSpend[] = campaigns.map((c) => ({
      id: c.id,
      status: c.status,
      dailyBudget: c.daily_budget,
      spend: latestSpend.get(c.id) ?? 0,
    }));

    const toPause = campaignsToAutoPause(spends, limits);
    if (!toPause.length) continue;

    const meta = await metaClientForBusiness(businessId, admin);
    if (!meta) continue;

    const paused: string[] = [];
    for (const id of toPause) {
      const campaign = campaigns.find((c) => c.id === id);
      if (!campaign?.meta_campaign_id) continue;
      try {
        await meta.updateCampaignStatus(campaign.meta_campaign_id, "PAUSED");
        await admin.from("campaigns").update({ status: "paused" }).eq("id", id);
        paused.push(id);
        await admin.from("audit_log").insert({
          business_id: businessId,
          actor_id: null,
          actor_label: "cron",
          action: "spend.auto_paused",
          entity_type: "campaign",
          entity_id: id,
          meta_object_id: campaign.meta_campaign_id,
          reason: `Weekly spend cap of ₹${limits.weeklyCapRupees} reached (cron sweep)`,
          details: {} as unknown as Json,
        });
      } catch {
        // Leave it running rather than fail the whole sweep; next run retries.
      }
    }
    if (paused.length) swept.push({ businessId, paused });
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), swept });
}
