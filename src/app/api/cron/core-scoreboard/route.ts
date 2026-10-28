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
  SCOREBOARD_SIGN_UP_PREFIX,
  type ScoreAiCall,
  type ScoreEvent,
  type ScoreLaunch,
} from "@/lib/observability/core-scoreboard";
import { observeRoute } from "@/lib/observability/logger";
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
    const [events, signUps, planRequests, aiCalls, launches, active] = await Promise.all([
      pages<ScoreEvent>((from, to) => db.from("product_events").select(eventColumns)
        .gte("created_at", since).in("name", [...SCOREBOARD_EVENT_NAMES])
        .order("created_at").range(from, to).abortSignal(signal())),
      pages<ScoreEvent>((from, to) => db.from("product_events").select(eventColumns)
        .gte("created_at", since).like("name", `${SCOREBOARD_SIGN_UP_PREFIX}%`)
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
    ]);
    const results: Array<{ campaign_id: string; fetched_at: string }> = [];
    for (let i = 0; i < active.length; i += PAGE_IDS) {
      const ids = active.slice(i, i + PAGE_IDS).map((campaign) => campaign.id);
      results.push(...await pages<{ campaign_id: string; fetched_at: string }>((from, to) => db.from("campaign_results")
        .select("campaign_id, fetched_at").in("campaign_id", ids).gte("fetched_at", since)
        .order("fetched_at").range(from, to).abortSignal(signal())));
    }
    // Same rule as `freeImagesOnly` (spend-policy.ts): internal and not exempt means free images.
    const users = [...new Set([
      ...[...events, ...signUps].map((event) => event.user_id),
      ...aiCalls.filter((call) => call.route === "creatives.generate").map((call) => call.user_id),
    ].filter((id): id is string => Boolean(id) && !smokeUsers.includes(id as string)))];
    const freeImageUserIds: string[] = [];
    // #1242: internal and demo accounts are left out of the owner rows.
    const internalUserIds: string[] = [];
    for (const id of users) {
      const { data, error: userError } = await db.auth.admin.getUserById(id);
      if (userError || !data?.user) throw new Unavailable();
      if (isInternalUser(data.user)) internalUserIds.push(id);
      if (isInternalUser(data.user) && !isExemptFromFreeProviders(data.user)) freeImageUserIds.push(id);
    }
    const signUpUsers = [...new Set(signUps.map((event) => event.user_id).filter((id): id is string => Boolean(id)))];
    const businessOwners = signUpUsers.length
      ? await pages<{ id: string; owner_id: string }>((from, to) => db.from("businesses").select("id, owner_id")
        .in("owner_id", signUpUsers).order("id").range(from, to).abortSignal(signal()))
      : [];
    const board = buildScoreboard({
      events: [...events, ...signUps, ...planRequests],
      aiCalls,
      launches,
      activeResults: newestResults(active, results),
      freeImageUserIds,
      excludedUserIds: smokeUsers,
      excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
      businessOwners,
      internalUserIds,
      since: new Date(since),
      until,
    });
    return NextResponse.json({ ok: true, ...board });
  } catch {
    return NextResponse.json({ ok: false, error: "Scoreboard data is unavailable." }, { status: 503 });
  }
}
