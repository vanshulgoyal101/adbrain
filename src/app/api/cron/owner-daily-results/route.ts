import { NextResponse } from "next/server";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireScheduledBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { deliverOwnerAlert, ownerAlertsConfig } from "@/lib/alerts/sender";
import { supabaseAlertStore } from "@/lib/alerts/alert-store";
import { dailyResultsParams, inDailyWindow, istYesterday } from "@/lib/alerts/daily-results";
import { cronAuthError } from "@/lib/security/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Campaigns read per business: the most recently launched live or paused ones. */
const CAMPAIGNS_PER_BUSINESS = 10;

/**
 * #1022 (#701): the daily results line on WhatsApp. Called by the scheduler every 15 minutes; it acts
 * only between 09:00 and 12:00 IST and while `OWNER_ALERTS_ENABLED` is on, and sends each opted-in
 * owner at most one line per day (the claim is keyed by the date). A day with no spend and no enquiry
 * sends nothing. One owner's Meta failure is listed, not a failed run.
 */
export const GET = observeRoute("/api/cron/owner-daily-results", "GET", async (request: Request) => {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;
  const config = ownerAlertsConfig();
  if (!config) return NextResponse.json({ ok: true, skipped: "disabled" });
  const now = new Date();
  if (!inDailyWindow(now)) return NextResponse.json({ ok: true, skipped: "outside 09:00-12:00 IST" });
  const day = istYesterday(now);
  const admin = createAdminClient();
  const untyped = admin as unknown as { from(table: string): ReturnType<typeof admin.from> };

  const [{ data: owners, error: ownersError }, { data: done, error: doneError }] = await Promise.all([
    untyped.from("owner_alert_prefs").select("business_id")
      .eq("daily_results", true).not("verified_at", "is", null).is("opted_out_at", null).is("paused_at", null).limit(1000),
    untyped.from("owner_alert_sends").select("business_id").eq("kind", "daily").eq("dedupe_key", day).limit(1000),
  ]);
  if (ownersError || doneError) return NextResponse.json({ ok: false, error: "Alert owners could not be loaded." }, { status: 503 });
  const already = new Set((done as { business_id: string }[] | null ?? []).map((row) => row.business_id));
  const store = supabaseAlertStore(admin as unknown as Parameters<typeof supabaseAlertStore>[0]);
  const deadline = AbortSignal.timeout(45_000);
  const outcomes: { businessId: string; result: string }[] = [];

  for (const { business_id: businessId } of (owners as { business_id: string }[] | null ?? [])) {
    if (already.has(businessId)) continue;
    if (deadline.aborted) { outcomes.push({ businessId, result: "deadline" }); continue; }
    try {
      const [{ data: business }, { data: campaigns, error }] = await Promise.all([
        admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
        admin.from("campaigns").select("meta_campaign_id").eq("business_id", businessId).in("status", ["active", "paused"])
          .not("meta_campaign_id", "is", null).order("launched_at", { ascending: false, nullsFirst: false }).limit(CAMPAIGNS_PER_BUSINESS),
      ]);
      if (error) throw error;
      const ids = (campaigns ?? []).map((campaign) => campaign.meta_campaign_id).filter((id): id is string => Boolean(id));
      if (!ids.length) { outcomes.push({ businessId, result: "no_campaigns" }); continue; }
      const context = await requireScheduledBusiness(businessId, request);
      const days = await withMetaConnection(context, { purpose: "read_insights", signal: deadline }, async (meta) =>
        Promise.all(ids.map(async (id) => {
          const ads = await meta.getAdResults(id, { day });
          return { whatsapp: ads.some((ad) => ad.whatsappOpens !== undefined), ads };
        })));
      const line = { businessName: business?.name ?? "", day, campaigns: days };
      if (!dailyResultsParams(line, "en")) { outcomes.push({ businessId, result: "empty_day" }); continue; }
      const sent = await deliverOwnerAlert({ store, config }, {
        businessId, kind: "daily", key: day, params: (language) => dailyResultsParams(line, language)!,
      });
      outcomes.push({ businessId, result: sent.reason });
    } catch {
      outcomes.push({ businessId, result: "error" });
    }
  }
  return NextResponse.json({
    ok: true, day,
    sent: outcomes.filter((outcome) => outcome.result === "sent").length,
    outcomes,
  });
});
