import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllByCursor } from "@/lib/supabase/queries";
import { requireScheduledBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { isTokenFailure, reauthEntry, type ReauthEntry } from "@/lib/meta/reauth";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { saveCampaignHealth, saveCampaignResult } from "@/lib/campaign/trusted-write";
import { assessCampaignHealth, readCampaignHealth, type CampaignHealth } from "@/lib/campaign/health";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESULT_INTERVAL_MS = 3_600_000;
const START_BUDGET_MS = 40_000;
// Problems first seen this recently are reported. pg_cron refreshes hourly (#274) but the issue-opening
// GitHub run can come hours later; it dedupes by key, so a wide window repeats nothing.
const ALERT_WINDOW_MS = 24 * 3_600_000;

/**
 * Scheduled results refresh (#258): at most hourly per active campaign, read Meta
 * insights and ad review read-only, save one result row and the campaign's health
 * flags. Never pauses or changes a campaign; enforcement stays in enforce-spend.
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
      const query = admin.from("campaigns").select("*").eq("status", "active").order("id").limit(100);
      return after ? query.gt("id", after) : query;
    }, "Active campaigns could not be loaded.", campaign => campaign.id);
  } catch {
    return NextResponse.json({ ok: false, error: "Active campaigns could not be loaded." }, { status: 503 });
  }

  let refreshed = 0, skipped = 0, failed = 0, hasMore = false;
  const reauth = new Map<string, ReauthEntry>();
  const health = new Map<string, CampaignHealth | null>(campaigns.map(campaign => [campaign.id, readCampaignHealth(campaign.raw)]));
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
    if (latestError) { failed++; continue; }
    if (latest && Date.now() - Date.parse(latest.fetched_at) < RESULT_INTERVAL_MS) { skipped++; continue; }
    try {
      const context = await requireScheduledBusiness(campaign.business_id, request);
      const { insights, review } = await withMetaConnection(context, {
        purpose: "read_insights",
        binding: { adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId },
        expectedGeneration: binding.metaConnectionGeneration,
      }, async meta => ({
        insights: await meta.getCampaignInsights(campaign.meta_campaign_id!),
        review: await meta.readAdReview(campaign.meta_campaign_id!).catch(() => null),
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
      const assessed = assessCampaignHealth({
        raw: campaign.raw, now: new Date(), impressions: insights.impressions, review,
        key: (kind, since) => createHash("sha256").update(`${campaign.id}:${kind}:${since}`).digest("hex").slice(0, 12),
      });
      const { error: healthError } = await saveCampaignHealth(context, campaign.id, assessed);
      if (healthError) throw new Error("Health storage unavailable.");
      health.set(campaign.id, assessed);
      refreshed++;
    } catch (error) {
      const dead = isTokenFailure(error) ? await reauthEntry(campaign.business_id, [error],
        campaigns.filter(({ business_id }) => business_id === campaign.business_id).length) : null;
      if (dead) reauth.set(campaign.business_id, dead);
      else failed++;
    }
  }

  const alerts = [...health.values()].flatMap(current => current?.flags ?? [])
    .filter(flag => Date.now() - Date.parse(flag.since) <= ALERT_WINDOW_MS)
    .map(({ kind, key }) => ({ kind, key }));
  return NextResponse.json({ ok: failed === 0, refreshed, skipped, failed, hasMore, alerts, reauth: [...reauth.values()] }, { status: failed ? 503 : 200 });
}
