import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireScheduledBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
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
export const GET = observeRoute("/api/cron/enforce-spend", "GET", handleGET);

async function handleGET(request: Request) {
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
      { ok: false, error: "Spend limits could not be loaded." },
      { status: 502 },
    );
  }

  const swept: Array<{ businessId: string; paused: string[] }> = [];
  let incomplete = false;

  for (const row of limitRows ?? []) {
    const businessId = row.business_id;
    const limits: SpendLimits = {
      weeklyCapRupees: row.weekly_cap_rupees,
      alertPct: row.alert_pct,
      autoPause: row.auto_pause,
    };

    const { data: campaigns, error: campaignsError } = await admin
      .from("campaigns")
      .select("*")
      .eq("business_id", businessId);
    if (campaignsError) { incomplete = true; continue; }
    if (!campaigns?.length) continue;

    // Latest tracked spend per campaign (results are newest-first).
    const { data: results, error: resultsError } = await admin
      .from("campaign_results")
      .select("campaign_id, spend, fetched_at")
      .in(
        "campaign_id",
        campaigns.map((c) => c.id),
      )
      .order("fetched_at", { ascending: false });
    if (resultsError) { incomplete = true; continue; }
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

    const paused: string[] = [];
    let context;
    try {
      context = await requireScheduledBusiness(businessId, request);
    } catch {
      incomplete = true;
      continue;
    }
    for (const id of toPause) {
      const campaign = campaigns.find((c) => c.id === id);
      if (!campaign?.meta_campaign_id) { incomplete = true; continue; }
      const storedBinding = readStoredCampaignBinding(campaign);
      if (
        !storedBinding.metaAdAccountId ||
        !storedBinding.metaPageId ||
        storedBinding.metaConnectionGeneration === null
      ) {
        incomplete = true;
        continue;
      }
      try {
        await withMetaConnection(
          context,
          {
            purpose: "pause",
            binding: {
              adAccountId: storedBinding.metaAdAccountId,
              pageId: storedBinding.metaPageId,
            },
            expectedGeneration: storedBinding.metaConnectionGeneration,
          },
          (meta) => meta.updateCampaignStatus(campaign.meta_campaign_id!, "PAUSED"),
        );
        const { error: updateError } = await admin.from("campaigns").update({ status: "paused" }).eq("id", id);
        if (updateError) { incomplete = true; continue; }
        paused.push(id);
        const { error: auditError } = await admin.rpc("append_verified_audit_event", {
          p_business_id: businessId,
          p_actor_id: null,
          p_system_actor: "cron",
          p_action: "spend.auto_paused",
          p_entity_type: "campaign",
          p_entity_id: id,
          p_meta_object_id: campaign.meta_campaign_id,
          p_reason: `Weekly spend cap of ₹${limits.weeklyCapRupees} reached (cron sweep)`,
          p_details: {} as unknown as Json,
        });
        if (auditError) incomplete = true;
      } catch {
        incomplete = true;
      }
    }
    if (paused.length) swept.push({ businessId, paused });
  }

  return NextResponse.json({ ok: !incomplete, at: new Date().toISOString(), swept }, { status: incomplete ? 503 : 200 });
}
