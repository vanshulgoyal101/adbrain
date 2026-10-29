import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllByCursor } from "@/lib/supabase/queries";
import { confirmCustomerCampaign, getCustomerBalance, listSettlingBusinesses } from "@/lib/payments/customer-balance";
import { refreshOpenRunCosts, settlePausedRuns } from "@/lib/payments/meta-cost-evidence";
import { fundingMode } from "@/lib/payments/operator-funding";
import { cappedRunEnded } from "@/lib/campaign/activation";
import { metaCapEndTime } from "@/lib/campaign/gone-in-meta";
import { saveOutsideChanges } from "@/lib/campaign/outside-changes";
import {
  requireScheduledBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { reauthEntry, type ReauthEntry } from "@/lib/meta/reauth";
import { managedAccountsEnabled } from "@/lib/meta/managed-account";
import { sweepManagedSpendCaps } from "@/lib/managed/spend-cap-wiring";
import {
  DEFAULT_SPEND_LIMITS,
  weeklySpendDecision,
  type SpendLimits,
} from "@/lib/campaign/spend";
import type { Json } from "@/lib/types";
import { withoutDuplicates } from "@/lib/campaign/campaign-owner";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Runaway-spend backstop.
 *
 * The per-campaign refresh route only enforces the weekly cap while a user is
 * looking at the app; Meta, however, spends around the clock. This cron sweeps
 * businesses with active campaigns and pauses them for customer holds or when
 * opted-in weekly spend has reached the cap or cannot be verified. It also
 * pauses capped runs whose end time has passed, and settles paused runs that
 * still hold a reserve: once Meta confirms the stop and the spend has settled,
 * SQL records final evidence and releases the reserve (#221). Managed child ad accounts get their
 * Meta spending limit refreshed from the customer's balance (#522). It runs
 * under the service-role client (no user session). A business whose owner must
 * reconnect Meta is listed in `reauth` and its Meta reads and pauses do not fail the run (#758).
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = observeRoute("/api/cron/enforce-spend", "GET", handleGET);

/** Managed limits start no new refresh after this, leaving the rest of `maxDuration` to finish (QA #560). */
const MANAGED_SWEEP_BUDGET_MS = 45_000;

async function handleGET(request: Request) {
  const startedAt = Date.now();
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  let limitRows;
  try {
    limitRows = await readAllByCursor(after => {
      const query = admin.from("spend_limits")
        .select("business_id, weekly_cap_rupees, alert_pct, auto_pause")
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
  // Businesses whose spend data is missing: never reported as ₹0 (#49, #165).
  const unverified: string[] = [];
  let incomplete = false;
  // #758: dead owner tokens, reported by opaque key instead of failing the run.
  const reauth: ReauthEntry[] = [];
  let activeCampaigns;
  try {
    activeCampaigns = await readAllByCursor(after => {
      const query = admin.from("campaigns").select("id, business_id")
        .eq("status", "active").order("id").limit(100);
      return after ? query.gt("id", after) : query;
    }, "Active campaigns could not be loaded.", campaign => campaign.id);
  } catch {
    return NextResponse.json({ ok: false, error: "Active campaigns could not be loaded.", swept }, { status: 503 });
  }
  const limitsByBusiness = new Map(limitRows.map(row => [row.business_id, row]));
  const settlingBusinesses = await listSettlingBusinesses().catch(() => { incomplete = true; return [] as string[]; });

  for (const businessId of new Set([...activeCampaigns.map(campaign => campaign.business_id), ...settlingBusinesses])) {
    const row = limitsByBusiness.get(businessId);
    const limits: SpendLimits = row ? {
      weeklyCapRupees: row.weekly_cap_rupees,
      alertPct: row.alert_pct,
      autoPause: row.auto_pause,
    } : { ...DEFAULT_SPEND_LIMITS };

    let campaigns;
    try {
      campaigns = await readAllByCursor(after => {
        const query = admin.from("campaigns").select("*")
          .eq("business_id", businessId).order("id").limit(100);
        return after ? query.gt("id", after) : query;
      }, "Campaigns could not be loaded.", campaign => campaign.id);
      // #1138: another business's campaign duplicated here is neither counted, settled nor paused.
      campaigns = await withoutDuplicates(businessId, campaigns);
    } catch { incomplete = true; unverified.push(businessId); continue; }
    const hasActive = campaigns.some(campaign => campaign.status === "active");
    if (!hasActive && !settlingBusinesses.includes(businessId)) continue;

    let context;
    try {
      context = await requireScheduledBusiness(businessId, request);
    } catch {
      incomplete = true;
      unverified.push(businessId);
      continue;
    }
    // #245: an unreadable funding mode falls back to the customer rules (fail closed).
    // #759: only a managed business has an AdBrain allowance to hold; operator and own-account runs are capped on Meta.
    const metaFunded = await fundingMode(businessId).then(mode => mode !== "managed").catch(() => {
      incomplete = true;
      return false;
    });
    // Meta reads and pauses that failed for this business: a dead owner token puts it in `reauth`
    // instead (after the same fail-closed pauses), anything else fails the run as before.
    const metaErrors: unknown[] = [];
    let metaIncomplete = false;
    let customerBalance = null;
    if (!metaFunded) {
      const initialBalance = await getCustomerBalance(context).catch(() => null);
      const refresh = await refreshOpenRunCosts(context, campaigns, initialBalance);
      if (initialBalance && !refresh.complete) metaIncomplete = true;
      const settle = await settlePausedRuns(context, campaigns, initialBalance);
      if (!settle.complete) metaIncomplete = true;
      if (!hasActive) {
        await settleMetaOutcome(businessId, metaErrors, metaIncomplete, false, 0);
        continue;
      }
      customerBalance = refresh.observed || settle.read ? await getCustomerBalance(context).catch(() => null) : initialBalance;
    } else if (!hasActive) continue;
    // #245/#759: a run funded on Meta (operator or own account) is capped there and has no customer allowance to hold.
    const financialHold = !metaFunded && (!customerBalance || customerBalance.held);
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
        })).catch((error: unknown) => { metaErrors.push(error); throw error; });
      });

    const paused: string[] = [];
    // A capped run whose Meta end time has passed is paused here, then settles like any paused run (#221),
    // with or without a customer reservation (#2281: an own-account run has none and stayed 'active').
    const ended = new Set(campaigns.filter(campaign => campaign.status === "active" && cappedRunEnded(campaign.raw)).map(campaign => campaign.id));
    const toPause = [...new Set([...decision.toPause, ...ended])];
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
      const binding = { adAccountId: storedBinding.metaAdAccountId, pageId: storedBinding.metaPageId };
      // #2290: paused only because the stored end time passed? The owner may have moved the end date in Ads Manager
      // since the last refresh, so Meta's own end time decides. An unreadable answer still pauses (fail closed).
      if (ended.has(id) && !decision.toPause.includes(id)) {
        const extended = await withMetaConnection(context, { purpose: "read_insights", binding, expectedGeneration: storedBinding.metaConnectionGeneration },
          meta => meta.getCampaignInsights(campaign.meta_campaign_id!))
          .then(async ({ metaState }) => {
            const metaEnd = metaState ? metaCapEndTime(campaign.raw, metaState) : null;
            if (!metaEnd || Date.parse(metaEnd) <= Date.now()) return false;
            await saveOutsideChanges(context, campaign, metaState).catch(() => null);
            return true;
          }).catch(() => false);
        if (extended) continue;
      }
      try {
        await withMetaConnection(
          context,
          {
            purpose: "pause",
            binding,
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
          p_reason: financialHold ? "Customer advertising funds or attributed costs require reconciliation (cron sweep)" : decision.toPause.includes(id) ? decision.verified ? `Weekly spend cap of ₹${limits.weeklyCapRupees} reached (cron sweep)` : "Weekly spend observation could not be verified (cron sweep)" : "Capped run reached its end time (cron sweep)",
          p_details: {} as unknown as Json,
        });
        if (auditError) incomplete = true;
      } catch (error) {
        metaErrors.push(error);
        metaIncomplete = true;
      }
    }
    if (paused.length) swept.push({ businessId, paused });
    // An unknown customer balance is a database failure, never a token one.
    if (financialHold && !decision.verified) { incomplete = true; unverified.push(businessId); }
    await settleMetaOutcome(businessId, metaErrors, metaIncomplete, !financialHold && !decision.verified,
      campaigns.filter(campaign => campaign.status === "active").length);
  }

  async function settleMetaOutcome(businessId: string, errors: unknown[], failed: boolean, decisionUnverified: boolean, activeCount: number) {
    if (!failed && !decisionUnverified) return;
    const dead = await reauthEntry(businessId, errors, activeCount);
    if (dead) { reauth.push(dead); return; }
    incomplete = true;
    if (decisionUnverified) unverified.push(businessId);
  }

  // #522: each managed child ad account's Meta spending limit follows its customer's balance, so
  // holds from cost evidence and missed payment events are applied within one sweep.
  let managedSpendCaps: Array<{ businessId: string; status: string }> = [];
  if (managedAccountsEnabled()) {
    try {
      const sweep = await sweepManagedSpendCaps({
        deadline: startedAt + MANAGED_SWEEP_BUDGET_MS,
        context: (businessId) => requireScheduledBusiness(businessId, request),
      });
      if (sweep.incomplete) incomplete = true;
      managedSpendCaps = sweep.results;
    } catch {
      incomplete = true;
    }
  }

  return NextResponse.json({ ok: !incomplete, at: new Date().toISOString(), swept, unverified, reauth, managedSpendCaps }, { status: incomplete ? 503 : 200 });
}
