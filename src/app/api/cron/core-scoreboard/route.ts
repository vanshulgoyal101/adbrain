import { NextResponse } from "next/server";
import internal from "@/lib/internal-accounts.json";
import { getEnv } from "@/lib/env";
import { isExemptFromFreeProviders, isInternalUser } from "@/lib/internal-accounts";
import {
  buildScoreboard,
  newestResults,
  SCOREBOARD_AI_ROUTES,
  SCOREBOARD_EVENT_NAMES,
  SCOREBOARD_PLAN_ROUTE,
  lastIstWeek,
  RESULTS_PAGES,
  type NorthStarData,
  type ScoreAiCall,
  type ScoreEvent,
  type ScoreLaunch,
} from "@/lib/observability/core-scoreboard";
import { observeRoute } from "@/lib/observability/logger";
import { isMetaTestLead } from "@/lib/leads/test-lead";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PAGE = 1000;
const MAX_PAGES = 30;
const PAGE_IDS = 100;

/**
 * Daily core scoreboard (#681), read-only: each core step's number against its target, smoke
 * excluded. `?hours=` 1–168 (default 24). Aggregates only; `.github/workflows/scheduled-jobs.yml`
 * posts the markdown on #681 once a day and `npm run core-scoreboard` prints it.
 */
export const GET = observeRoute("/api/cron/core-scoreboard", "GET", handleGET);

class Unavailable extends Error {}

type Page = PromiseLike<{ data: unknown; error: unknown }>;

async function pages<T>(query: (from: number, to: number) => Page): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !Array.isArray(data)) throw new Unavailable();
    rows.push(...(data as T[]));
    if (data.length < PAGE) return rows;
  }
  throw new Unavailable();
}

async function handleGET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = new URL(request.url).searchParams.get("hours");
  const hours = raw === null ? 24 : Number(raw);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    return NextResponse.json({ ok: false, error: "hours must be a whole number from 1 to 168." }, { status: 400 });
  }
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3_600_000).toISOString();
  const db = createAdminClient();
  const signal = () => AbortSignal.timeout(10_000);
  const eventColumns = "name, outcome, user_id, business_id, duration_ms, attributes, created_at";
  try {
    const smokeUsers = internal.smokeUserIds;
    const { data: owned, error } = await db.from("businesses").select("id").in("owner_id", smokeUsers).abortSignal(signal());
    if (error || !Array.isArray(owned)) throw new Unavailable();
    // #1242 / #1284: the north-star rows read the last full IST week and the trailing 7 days.
    const week = lastIstWeek(until);
    const weekStart = new Date(week.start).toISOString();
    const weekEnd = new Date(week.end).toISOString();
    const sevenDays = new Date(until.getTime() - 7 * 86_400_000).toISOString();
    const [events, planRequests, aiCalls, launches, active, businesses, changes, campaigns, pageViews, helpTaps, leads] = await Promise.all([
      pages<ScoreEvent>((from, to) => db.from("product_events").select(eventColumns)
        .gte("created_at", since).in("name", [...SCOREBOARD_EVENT_NAMES])
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<ScoreEvent>((from, to) => db.from("product_events").select(eventColumns)
        .gte("created_at", since).eq("name", "http.request").eq("attributes->>route", SCOREBOARD_PLAN_ROUTE)
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<ScoreAiCall>((from, to) => db.from("llm_usage_events").select("route, status, user_id, business_id, request_id, latency_ms, created_at")
        .gte("created_at", since).in("route", [...SCOREBOARD_AI_ROUTES])
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<ScoreLaunch>((from, to) => db.from("campaign_operations").select("business_id, state, created_at")
        .gte("created_at", since).eq("kind", "campaign_create")
        .order("created_at").range(from, to).abortSignal(signal())),
      // The campaigns refresh-results keeps fresh: active and bound to a Meta campaign (#992).
      pages<{ id: string; business_id: string }>((from, to) => db.from("campaigns").select("id, business_id")
        .eq("status", "active").not("meta_campaign_id", "is", null)
        .order("id").range(from, to).abortSignal(signal())),
      pages<{ id: string; owner_id: string }>((from, to) => db.from("businesses").select("id, owner_id")
        .order("id").range(from, to).abortSignal(signal())),
      pages<{ entity_id: string; business_id: string; action: string; created_at: string }>((from, to) => db.from("audit_log")
        .select("entity_id, business_id, action, created_at").eq("entity_type", "campaign")
        .in("action", ["campaign.resume", "campaign.pause", "spend.auto_paused"]).not("entity_id", "is", null)
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<{ id: string; business_id: string; status: string }>((from, to) => db.from("campaigns").select("id, business_id, status")
        .order("id").range(from, to).abortSignal(signal())),
      pages<{ user_id: string; attributes: { route?: string } | null; created_at: string }>((from, to) => db.from("product_events")
        .select("user_id, attributes, created_at").eq("name", "page.view").gte("created_at", weekStart).lt("created_at", weekEnd)
        .in("attributes->>route", [...RESULTS_PAGES]).order("created_at").range(from, to).abortSignal(signal())),
      pages<{ user_id: string; created_at: string }>((from, to) => db.from("product_events").select("user_id, created_at")
        .eq("name", "ui.action").eq("attributes->>action", "help.whatsapp").gte("created_at", weekStart)
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<{ business_id: string; full_name: string | null; created_time: string | null; created_at: string; first_contacted_at: string | null }>((from, to) => db.from("leads")
        .select("business_id, full_name, created_time, created_at, first_contacted_at").gte("created_at", sevenDays)
        .in("source", ["meta_form", "whatsapp_manual"]).order("created_at").range(from, to).abortSignal(signal())),
    ]);
    const results: Array<{ campaign_id: string; fetched_at: string }> = [];
    for (let i = 0; i < active.length; i += PAGE_IDS) {
      const ids = active.slice(i, i + PAGE_IDS).map((campaign) => campaign.id);
      results.push(...await pages<{ campaign_id: string; fetched_at: string }>((from, to) => db.from("campaign_results")
        .select("campaign_id, fetched_at").in("campaign_id", ids).gte("fetched_at", since)
        .order("fetched_at").range(from, to).abortSignal(signal())));
    }
    // Every account: the free-image split (`freeImagesOnly`: internal and not exempt) and #1242's exclusions and sign-ups.
    const identities: Array<{ id: string; email?: string | null; email_confirmed_at?: string | null; created_at: string }> = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error: usersError } = await db.auth.admin.listUsers({ page, perPage: PAGE });
      if (usersError || !data) throw new Unavailable();
      identities.push(...data.users);
      if (data.users.length < PAGE) break;
    }
    // A maker's account must be read, or the free/paid split would be a guess.
    const known = new Set(identities.map((user) => user.id));
    const makers = [...events.filter((event) => event.name === "creative.batch").map((event) => event.user_id),
      ...aiCalls.filter((call) => call.route === "creatives.generate").map((call) => call.user_id)];
    if (makers.some((id) => id && !smokeUsers.includes(id) && !known.has(id))) throw new Unavailable();
    const freeImageUserIds = identities.filter((user) => isInternalUser(user) && !isExemptFromFreeProviders(user)).map((user) => user.id);
    const internalUserIds = [...identities.filter((user) => isInternalUser(user)).map((user) => user.id), ...smokeUsers];
    const internalBusinesses = new Set(businesses.filter((business) => internalUserIds.includes(business.owner_id)).map((business) => business.id));
    const northStar: NorthStarData = {
      signUps: identities.filter((user) => Date.parse(user.created_at) >= week.start).map(({ id, created_at }) => ({ id, created_at })),
      businesses,
      campaignChanges: changes.map(({ entity_id, ...change }) => ({ campaign_id: entity_id, ...change })),
      campaigns,
      pageViews: pageViews.map((view) => ({ user_id: view.user_id, route: view.attributes?.route ?? "", created_at: view.created_at })),
      helpTaps,
      leads: leads.filter((lead) => !internalBusinesses.has(lead.business_id) && !isMetaTestLead(lead)),
      internalUserIds,
      now: until,
    };
    const board = buildScoreboard({
      events: [...events, ...planRequests],
      aiCalls,
      launches,
      activeResults: newestResults(active, results),
      freeImageUserIds,
      excludedUserIds: smokeUsers,
      excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
      northStar,
      since: new Date(since),
      until,
    });
    return NextResponse.json({ ok: true, ...board });
  } catch {
    return NextResponse.json({ ok: false, error: "Scoreboard data is unavailable." }, { status: 503 });
  }
}
