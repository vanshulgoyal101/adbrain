import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adResultsEnabled, saveAdResults } from "@/lib/campaign/ad-results-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllByCursor } from "@/lib/supabase/queries";
import { requireScheduledBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { isTokenFailure, reauthEntry, type ReauthEntry } from "@/lib/meta/reauth";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { saveCampaign, saveCampaignHealth, saveCampaignResult } from "@/lib/campaign/trusted-write";
import { CampaignGoneError, MetaError, metaErrorCode } from "@/lib/meta/client";
import { ConnectionAccessError } from "@/lib/meta/connection-access-error";
import { assessCampaignHealth, readCampaignHealth, type CampaignHealth } from "@/lib/campaign/health";
import { PAUSE_ACTIONS, pausedResultsReadDue } from "@/lib/campaign/paused-results";

export const runtime = "nodejs";
export const maxDuration = 60;

// pg_cron calls this every 15 min; 14 min lets every run refresh each live campaign, so results stay
// ≤ 15 min old (#992). One read-only insights read per active campaign per run.
const RESULT_INTERVAL_MS = 14 * 60_000;
const START_BUDGET_MS = 40_000;
// Problems first seen this recently are reported. pg_cron runs every 15 min (#274) but the issue-opening
// GitHub run can come hours later; it dedupes by key, so a wide window repeats nothing.
const ALERT_WINDOW_MS = 24 * 3_600_000;

/**
 * Scheduled results refresh (#258, #992): every 15-min run per active campaign, read Meta
 * insights and ad review read-only, save one result row and the campaign's health
 * flags. A paused campaign gets its results only (#1003): once a day and once 7 days after
 * AdBrain paused it, and one lifetime read when it has none (an imported campaign).
 * Never pauses or changes a campaign; enforcement stays in enforce-spend.
 * Alerts carry only a problem kind and an opaque key (public workflow logs). A business
 * whose owner must reconnect Meta is listed once in `reauth`, not counted as failed (#758).
 */
export const GET = observeRoute("/api/cron/refresh-results", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminClient();
  let campaigns;
  try {
    campaigns = await readAllByCursor(after => {
      const query = admin.from("campaigns").select("*").in("status", ["active", "paused"]).order("id").limit(100);
      return after ? query.gt("id", after) : query;
    }, "Active campaigns could not be loaded.", campaign => campaign.id);
  } catch {
    return NextResponse.json({ ok: false, error: "Active campaigns could not be loaded." }, { status: 503 });
  }
  // Live campaigns first: paused follow-ups only use what's left of the run's budget.
  campaigns.sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"));
  const pausedAt = await lastPauses(admin, campaigns.filter(campaign => campaign.status === "paused").map(campaign => campaign.id));

  let refreshed = 0, pausedReads = 0, skipped = 0, failed = 0, hasMore = false;
  // #1592: which campaigns didn't refresh, by opaque key only (public workflow logs), and why.
  const failures: { key: string; code: string }[] = [], ended: string[] = [], unbound: string[] = [];
  const goneAlerts: { kind: "ended"; key: string }[] = [];
  const opaque = (id: string) => createHash("sha256").update(`refresh:${id}`).digest("hex").slice(0, 12);
  const reauth = new Map<string, ReauthEntry>();
  const health = new Map<string, CampaignHealth | null>(campaigns.filter(campaign => campaign.status === "active")
    .map(campaign => [campaign.id, readCampaignHealth(campaign.raw)]));
  for (const campaign of campaigns) {
    if (Date.now() - started > START_BUDGET_MS) { hasMore = true; break; }
    if (reauth.has(campaign.business_id)) { skipped++; continue; }
    const binding = readStoredCampaignBinding(campaign);
    if (!campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) {
      skipped++;
      continue;
    }
    const { data: latest, error: latestError } = await admin.from("campaign_results").select("fetched_at")
      .eq("campaign_id", campaign.id).order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    if (latestError) { failed++; failures.push({ key: opaque(campaign.id), code: "RESULTS_READ" }); continue; }
    const paused = campaign.status !== "active";
    if (paused ? !pausedAt || !pausedResultsReadDue(pausedAt.get(campaign.id) ?? null, latest?.fetched_at ?? null)
      : latest && Date.now() - Date.parse(latest.fetched_at) < RESULT_INTERVAL_MS) { skipped++; continue; }
    let context: Awaited<ReturnType<typeof requireScheduledBusiness>> | null = null;
    try {
      context = await requireScheduledBusiness(campaign.business_id, request);
      const { insights, review, ads } = await withMetaConnection(context, {
        purpose: "read_insights",
        binding: { adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId },
        expectedGeneration: binding.metaConnectionGeneration,
      }, async meta => ({
        insights: await meta.getCampaignInsights(campaign.meta_campaign_id!),
        review: paused ? null : await meta.readAdReview(campaign.meta_campaign_id!).catch(() => null),
        // #783: per-ad results ride along; a failure keeps the last stored rows.
        ads: adResultsEnabled() ? await meta.getAdResults(campaign.meta_campaign_id!).catch(() => null) : null,
      }));
      const { error: resultError } = await saveCampaignResult(context, {
        campaign_id: campaign.id,
        destination: insights.destination ?? "unknown",
        period_start: insights.periodStart ?? null,
        period_end: insights.periodEnd ?? null,
        impressions: insights.impressions,
        clicks: insights.clicks,
        leads: insights.leads,
        spend: insights.spend,
        cpl: insights.cpl,
        ...(insights.conversations !== undefined ? { conversations: insights.conversations, cost_per_conversation: insights.costPerConversation ?? null, whatsapp_opens: insights.whatsappOpens ?? null } : {}),
      });
      if (resultError) throw new Error("Result storage unavailable.");
      if (ads) await saveAdResults(admin as unknown as SupabaseClient, { businessId: campaign.business_id, campaignId: campaign.id, ads }).catch(() => false);
      // A paused campaign's delivery flags would only be false alarms.
      if (paused) { pausedReads++; continue; }
      const assessed = assessCampaignHealth({
        raw: campaign.raw, now: new Date(), impressions: insights.impressions, review,
        key: (kind, since) => createHash("sha256").update(`${campaign.id}:${kind}:${since}`).digest("hex").slice(0, 12),
      });
      const { error: healthError } = await saveCampaignHealth(context, campaign.id, assessed);
      if (healthError) throw new Error("Health storage unavailable.");
      health.set(campaign.id, assessed);
      refreshed++;
    } catch (error) {
      // #1592: deleted in Meta (or no longer there at all): end it as the manual refresh does (#721); not a failure.
      // #1678: only Meta's own DELETED/ARCHIVED status ends a campaign; a bare 100/33 can also mean "no permission".
      const gone = error instanceof CampaignGoneError ? error.metaStatus : null;
      if (gone && context) {
        const raw = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? campaign.raw : {};
        const { error: endError } = await saveCampaign(context, { status: "completed", raw: { ...raw, metaStatus: gone, metaGoneAt: new Date().toISOString() } }, campaign.id)
          .catch(() => ({ error: true }));
        if (!endError) {
          ended.push(opaque(campaign.id));
          // #1600: one 'ended' alert (the workflow opens one issue per key, once).
          goneAlerts.push({ kind: "ended", key: opaque(campaign.id) });
          continue;
        }
      }
      // The campaign's ad account or Page is no longer the business's connection, or Meta won't load it (100/33: gone or
      // no permission). Listed, never ended: it stays active, so enforce-spend keeps guarding it.
      if ((error instanceof ConnectionAccessError && error.code === "CONFLICT")
        || (error instanceof MetaError && error.code === 100 && error.subcode === 33)) { unbound.push(opaque(campaign.id)); continue; }
      const dead = isTokenFailure(error) ? await reauthEntry(campaign.business_id, [error],
        campaigns.filter(({ business_id }) => business_id === campaign.business_id).length) : null;
      if (dead) reauth.set(campaign.business_id, dead);
      else {
        failed++;
        failures.push({ key: opaque(campaign.id), code: error instanceof ConnectionAccessError ? error.code : metaErrorCode(error) });
      }
    }
  }

  const alerts = [...health.values()].flatMap(current => current?.flags ?? [])
    .filter(flag => Date.now() - Date.parse(flag.since) <= ALERT_WINDOW_MS)
    .map(({ kind, key }) => ({ kind, key }))
    .concat(goneAlerts.map(({ kind, key }) => ({ kind, key })));
  return NextResponse.json({ ok: failed === 0, refreshed, pausedReads, skipped, failed, hasMore, alerts, reauth: [...reauth.values()],
    failures, ended, unbound }, { status: failed ? 503 : 200 });
}

/** Each paused campaign's latest AdBrain pause, or null when its latest pause/resume is a resume; null map on a read failure. */
async function lastPauses(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Map<string, string | null> | null> {
  const latest = new Map<string, string | null>();
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const { data, error } = await admin.from("audit_log").select("entity_id, action, created_at")
      .eq("entity_type", "campaign").in("entity_id", chunk).in("action", [...PAUSE_ACTIONS, "campaign.resume"])
      .order("created_at", { ascending: false }).limit(1000);
    if (error || !data) return null;
    for (const row of data) {
      if (row.entity_id && !latest.has(row.entity_id)) latest.set(row.entity_id, row.action === "campaign.resume" ? null : row.created_at);
    }
  }
  return latest;
}
