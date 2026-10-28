import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { LeadSyncError, syncMetaLeads } from "@/lib/leads/sync";
import { friendlyMetaError, MetaThrottledError } from "@/lib/meta/client";
import { appThrottledUntil, recordThrottle, throttledBusinesses } from "@/lib/meta/throttle-store";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireScheduledBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { isTokenFailure, reauthEntry, recordMetaErrors, type ReauthEntry } from "@/lib/meta/reauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllByCursor } from "@/lib/supabase/queries";
import { ownerAlertsConfig } from "@/lib/alerts/sender";
import { supabaseAlertStore } from "@/lib/alerts/alert-store";
import { sendNewLeadAlerts, type LeadAlertRun } from "@/lib/alerts/lead-alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Outcome = {
  businessId: string;
  imported: number;
  sync?: { id: string; state: "complete" | "partial"; hasMore: boolean };
  failedForms: number;
  error?: string;
  alerts?: LeadAlertRun;
  /** #1838: Meta is throttling this business's account (or the app); retried on a later run, not a failure. */
  throttled?: { scope: MetaThrottledError["scope"]; retryAfterMs: number };
};

/**
 * Scheduled lead import (#165). For each business with a connected Meta Page it
 * resumes (or starts) the same bounded lead sync as `/api/leads/sync`: at most
 * 24 Graph reads per business per run, deduplicated by Meta lead id. A business
 * whose owner must reconnect Meta is listed in `reauth` and does not fail the run (#758).
 * With `OWNER_ALERTS_ENABLED`, each opted-in owner then gets one WhatsApp alert per new lead under
 * 24 h old (#701 v1); an alert failure is reported under `alerts` and never fails the sync.
 *
 * Called every 15 minutes by `.github/workflows/scheduled-jobs.yml` with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = observeRoute("/api/cron/sync-leads", "GET", handleGET);

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deadline = AbortSignal.timeout(45_000);
  const admin = createAdminClient();

  let connections;
  try {
    connections = await readAllByCursor(after => {
      const query = admin.from("meta_connections").select("business_id")
        .eq("authorization_status", "connected").not("ad_account_id", "is", null).not("page_id", "is", null)
        .order("business_id").limit(100);
      return after ? query.gt("business_id", after) : query;
    }, "Meta connections could not be loaded.", row => row.business_id);
  } catch {
    return NextResponse.json({ ok: false, error: "Meta connections could not be loaded." }, { status: 503 });
  }

  const alertConfig = ownerAlertsConfig();
  const alertStore = supabaseAlertStore(admin as unknown as Parameters<typeof supabaseAlertStore>[0]);
  const businesses: Outcome[] = [];
  const reauth: ReauthEntry[] = [];
  // #1838 slice 2: what earlier runs learned; the app-wide limit skips every business, a throttled account its own.
  const store = admin as unknown as SupabaseClient;
  let appThrottled = Boolean(await appThrottledUntil(store));
  const stillThrottled = await throttledBusinesses(store, connections.map((connection) => connection.business_id));
  for (const { business_id: businessId } of connections) {
    if (appThrottled) {
      businesses.push({ businessId, imported: 0, failedForms: 0, throttled: { scope: "app", retryAfterMs: 0 } });
      continue;
    }
    if (stillThrottled.has(businessId)) {
      businesses.push({ businessId, imported: 0, failedForms: 0, throttled: { scope: "account", retryAfterMs: Math.max(0, Date.parse(stillThrottled.get(businessId)!) - Date.now()) } });
      continue;
    }
    if (deadline.aborted) {
      businesses.push({ businessId, imported: 0, failedForms: 0, error: "Skipped: run deadline reached." });
      continue;
    }
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(20_000)]);
    const metaErrors: unknown[] = [];
    let outcome: Outcome;
    try {
      const context = await requireScheduledBusiness(businessId, request);
      const synced = await withMetaConnection(
        context,
        { purpose: "read_leads", signal },
        (meta, connection) => syncMetaLeads(context, connection, recordMetaErrors(meta, metaErrors), undefined, signal),
      );
      outcome = {
        businessId, imported: synced.imported, sync: synced.sync,
        failedForms: synced.failedForms.length, ...(synced.error ? { error: synced.error } : {}),
      };
    } catch (error) {
      metaErrors.push(error);
      outcome = {
        businessId, imported: 0, failedForms: 0,
        error: error instanceof LeadSyncError ? error.message : friendlyMetaError(error, "Could not sync leads."),
      };
    }
    if (alertConfig && !deadline.aborted) {
      try {
        const alerts = await sendNewLeadAlerts(
          { db: admin as unknown as Parameters<typeof sendNewLeadAlerts>[0]["db"], store: alertStore, config: alertConfig, signal: deadline },
          businessId,
        );
        if (alerts) outcome.alerts = alerts;
      } catch {
        outcome.alerts = { error: "alerts" };
      }
    }
    const throttle = metaErrors.find((error): error is MetaThrottledError => error instanceof MetaThrottledError);
    if (throttle) {
      outcome = { businessId, imported: outcome.imported, failedForms: 0, ...(outcome.sync ? { sync: outcome.sync } : {}),
        ...(outcome.alerts ? { alerts: outcome.alerts } : {}), throttled: { scope: throttle.scope, retryAfterMs: throttle.retryAfterMs } };
      await recordThrottle(store, businessId, throttle);
      if (throttle.scope === "app") appThrottled = true;
    }
    const dead = outcome.error && metaErrors.some(isTokenFailure) ? await reauthEntry(businessId, metaErrors) : null;
    if (dead) reauth.push(dead);
    else businesses.push(outcome);
  }

  const ok = businesses.every(business => !business.error);
  return NextResponse.json({
    ok,
    at: new Date().toISOString(),
    imported: businesses.reduce((total, business) => total + business.imported, 0),
    businesses,
    reauth,
  }, { status: ok ? 200 : 503 });
}
