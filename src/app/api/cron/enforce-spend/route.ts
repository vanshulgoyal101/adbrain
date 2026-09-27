import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllByCursor } from "@/lib/supabase/queries";
import { confirmCustomerCampaign, getCustomerBalance } from "@/lib/payments/customer-balance";
import {
  requireScheduledBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import {
  weeklySpendDecision,
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
 * active campaigns when current-week spend has reached the cap or cannot be
 * verified. It runs under the service-role client (no user session).
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
  let limitRows;
  try {
    limitRows = await readAllByCursor(after => {
      const query = admin.from("spend_limits")
        .select("business_id, weekly_cap_rupees, alert_pct, auto_pause")
        .eq("auto_pause", true).gt("weekly_cap_rupees", 0)
        .order("business_id").limit(100);
      return after ? query.gt("business_id", after) : query;
    }, "Spend limits could not be loaded.", row => row.business_id);
  } catch {
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

    let campaigns;
    try {
      campaigns = await readAllByCursor(after => {
        const query = admin.from("campaigns").select("*")
          .eq("business_id", businessId).order("id").limit(100);
        return after ? query.gt("id", after) : query;
      }, "Campaigns could not be loaded.", campaign => campaign.id);
    } catch { incomplete = true; continue; }
    if (!campaigns.some(campaign => campaign.status === "active")) continue;

    let context;
    try {
      context = await requireScheduledBusiness(businessId, request);
    } catch {
      incomplete = true;
      continue;
    }
    const customerBalance = await getCustomerBalance(context).catch(() => null);
    const financialHold = !customerBalance || customerBalance.held;
    const decision = financialHold
      ? { toPause: campaigns.filter(campaign => campaign.status === "active").map(campaign => campaign.id), verified: Boolean(customerBalance) }
      : await weeklySpendDecision(campaigns, limits, async campaign => {
        const binding = readStoredCampaignBinding(campaign);
        if (!campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) {
          throw new Error("Campaign binding is unavailable.");
        }
        return withMetaConnection(context, {
          purpose: "read_insights",
          binding: { adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId },
          expectedGeneration: binding.metaConnectionGeneration,
        }, async (meta, connection) => ({
          insights: await meta.getCampaignInsights(campaign.meta_campaign_id!, { weekly: true }),
          currency: connection.selected?.currency ?? null,
          timezoneName: connection.selected?.timezoneName ?? null,
        }));
      });
    if (!decision.verified) incomplete = true;

    const paused: string[] = [];
    const toPause = decision.toPause;
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
        const reservation = customerBalance?.reservations.find(item => item.campaignId === id && item.state !== "closed");
        if (reservation) await confirmCustomerCampaign(context, id, reservation.reservationId, "paused").catch(() => { incomplete = true; });
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
          p_reason: financialHold ? "Customer advertising funds or attributed costs require reconciliation (cron sweep)" : decision.verified ? `Weekly spend cap of ₹${limits.weeklyCapRupees} reached (cron sweep)` : "Weekly spend observation could not be verified (cron sweep)",
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
