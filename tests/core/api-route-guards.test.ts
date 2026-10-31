import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #1729 (CTO, from the Reviewer's #1723 sweep): about 20 PRs a day touch routes. One route that trusts a body
// businessId without an ownership check is a cross-tenant read or write. Every src/app/api route is classified here,
// and its file must call that class's guard; a new, renamed or reclassified route fails until it is listed.

type Kind = "owner" | "session" | "cron" | "webhook" | "delegated" | "public";
type Entry = { kind: Kind; methods: string[]; why?: string };

/** The guard each class must call. `session` routes are scoped by RLS or an owner-checking RPC; `why` says which. */
const GUARD: Record<Exclude<Kind, "public">, RegExp> = {
  owner: /\b(?:requireOwnedBusiness|ownedManagedAttempt|managedRouteUser|requireScheduledBusiness|ownedManagedBusiness)\(/,
  session: /\bauth\.getUser\(|\bgetPrimaryBusiness\(/,
  cron: /\bcronAuthError\(|CRON_SECRET/,
  webhook: /[Ss]ignature|signed_request/,
  delegated: /\b(?:handleProductionPayments|handleTestPayments)\(/,
};

/** Seeded from #1723's table (Reviewer, all routes checked by hand). */
const ROUTES: Record<string, Entry> = {
  "auth/outcome": { kind: "public", methods: ["POST"], why: "sign-in outcome from often signed-out callers: a fixed enum, same-origin only, rate-limited per address and overall" },
  "brand/autofill": { kind: "session", methods: ["POST"], why: "session: RLS client; reads only the text the owner sends" },
  "campaign-drafts": { kind: "owner", methods: ["GET", "POST"] },
  "campaign-drafts/[id]": { kind: "owner", methods: ["DELETE", "GET", "PUT"] },
  "campaigns/[id]": { kind: "owner", methods: ["DELETE", "GET", "PATCH"] },
  "campaigns/[id]/ads": { kind: "session", methods: ["GET"], why: "session: RLS client (the owner's own campaign rows)" },
  "campaigns/[id]/ads/[adId]": { kind: "owner", methods: ["PATCH"] },
  "campaigns/[id]/ads/[adId]/status": { kind: "owner", methods: ["POST"] },
  "campaigns/[id]/audience": { kind: "owner", methods: ["POST"] },
  "campaigns/[id]/audience/switch": { kind: "owner", methods: ["POST"] },
  "campaigns/[id]/budget": { kind: "owner", methods: ["POST"] },
  "campaigns/[id]/enquiries": { kind: "session", methods: ["DELETE", "POST"], why: "session: RLS client (the owner's own campaign rows)" },
  "campaigns/[id]/refresh": { kind: "owner", methods: ["POST"] },
  "campaigns/[id]/rerun": { kind: "session", methods: ["GET"], why: "session: RLS client (the owner's own campaign rows)" },
  "campaigns/create": { kind: "owner", methods: ["POST"] },
  "campaigns/lead-forms": { kind: "owner", methods: ["GET"] },
  "campaigns/list": { kind: "owner", methods: ["GET"] },
  "campaigns/operations": { kind: "owner", methods: ["GET"] },
  "campaigns/operations/[id]": { kind: "owner", methods: ["GET"] },
  "campaigns/plan": { kind: "owner", methods: ["POST"] },
  "campaigns/preflight": { kind: "owner", methods: ["POST"] },
  "campaigns/report": { kind: "session", methods: ["GET"], why: "session: RLS client (the owner's own campaigns)" },
  "campaigns/sync": { kind: "owner", methods: ["POST"] },
  "creatives/[id]/background": { kind: "session", methods: ["POST"], why: "session: business loaded through RLS before creative_regeneration_claim (#1723)" },
  "creatives/[id]/photo-fit": { kind: "session", methods: ["GET"], why: "session: RLS client (the owner's own creative and Brand photos, #1904)" },
  "creatives/[id]/picture": { kind: "session", methods: ["POST"], why: "session: RLS client (the owner's own creative)" },
  "creatives/[id]/regenerate": { kind: "session", methods: ["POST"], why: "session: business loaded through RLS before creative_regeneration_claim (#1723)" },
  "creatives/assistant": { kind: "session", methods: ["POST"], why: "session: RLS client" },
  "creatives/export": { kind: "session", methods: ["POST"], why: "session: RLS client" },
  "creatives/generate": { kind: "session", methods: ["GET", "POST"], why: "session: POST loads the business through RLS before creative_generation_admit; GET's RPC checks owner_id (#1723)" },
  "cron/access-requests": { kind: "cron", methods: ["GET"] },
  "cron/campaign-reconciliation": { kind: "cron", methods: ["GET"] },
  "cron/core-scoreboard": { kind: "cron", methods: ["GET"] },
  "cron/enforce-spend": { kind: "cron", methods: ["GET"] },
  "cron/keepalive": { kind: "cron", methods: ["GET"] },
  "cron/llm-credit": { kind: "cron", methods: ["GET"] },
  "cron/managed-health": { kind: "cron", methods: ["GET"] },
  "cron/meta-parent-health": { kind: "cron", methods: ["GET"] },
  "cron/owner-daily-results": { kind: "cron", methods: ["GET"] },
  "cron/payment-health": { kind: "cron", methods: ["GET"] },
  "cron/pilot-readiness": { kind: "cron", methods: ["GET"] },
  "cron/refresh-results": { kind: "cron", methods: ["GET"] },
  "cron/scheduler-health": { kind: "cron", methods: ["GET"] },
  "cron/sync-leads": { kind: "cron", methods: ["GET"] },
  "events": { kind: "session", methods: ["POST"], why: "session: business from getPrimaryBusiness(), never from input" },
  "feedback/pilot-day7": { kind: "owner", methods: ["POST"] },
  "internal/meta-traffic": { kind: "session", methods: ["POST"], why: "session: email allowlist, rate-limited, 404 in production without it (#1723)" },
  "leads": { kind: "session", methods: ["DELETE", "GET"], why: "session: RLS client (the owner's own leads)" },
  "leads/[id]": { kind: "session", methods: ["DELETE", "PATCH"], why: "session: RLS client (the owner's own leads); DELETE runs leads_erase as the caller (#1761)" },
  "leads/sync": { kind: "owner", methods: ["POST"] },
  "leads/unseen": { kind: "session", methods: ["GET"], why: "session: RLS client (the owner's own leads)" },
  "managed/onboarding": { kind: "owner", methods: ["GET"] },
  "managed/whatsapp": { kind: "owner", methods: ["POST"] },
  "meta/access-request": { kind: "session", methods: ["POST"], why: "session: append_verified_audit_event refuses a business the user doesn't own (#1723)" },
  "meta/accounts": { kind: "owner", methods: ["GET"] },
  "meta/connect": { kind: "owner", methods: ["POST"] },
  "meta/connections/attempts/[id]": { kind: "session", methods: ["GET"], why: "session: the attempt is read for its own user" },
  "meta/connections/attempts/[id]/retry": { kind: "session", methods: ["POST"], why: "session: the attempt is read for its own user" },
  "meta/connections/attempts/[id]/select": { kind: "session", methods: ["POST"], why: "session: the attempt is read for its own user" },
  "meta/connections/change": { kind: "owner", methods: ["POST"] },
  "meta/connections/recheck": { kind: "owner", methods: ["POST"] },
  "meta/connections/start": { kind: "owner", methods: ["POST"] },
  "meta/connections/status": { kind: "owner", methods: ["GET"] },
  "meta/deauthorize": { kind: "webhook", methods: ["POST"] },
  "meta/disconnect": { kind: "owner", methods: ["POST"] },
  "meta/geo-search": { kind: "session", methods: ["GET"], why: "session: Meta place search; no business data" },
  "meta/managed/page": { kind: "owner", methods: ["GET", "POST"] },
  "meta/managed/provision": { kind: "owner", methods: ["POST"] },
  "meta/oauth/callback": { kind: "owner", methods: ["GET"] },
  "meta/oauth/start": { kind: "public", methods: ["GET"], why: "stub: redirects to Settings (contextual connect); reads and writes nothing" },
  "meta/whatsapp": { kind: "owner", methods: ["GET"] },
  "payments/customer-balance": { kind: "owner", methods: ["GET", "POST"] },
  "payments/live/operator": { kind: "delegated", methods: ["GET", "POST"] },
  "payments/live/orders": { kind: "delegated", methods: ["GET", "POST"] },
  "payments/live/reconcile": { kind: "delegated", methods: ["POST"] },
  "payments/live/verify": { kind: "delegated", methods: ["POST"] },
  "payments/live/webhook": { kind: "delegated", methods: ["POST"] },
  "payments/test/orders": { kind: "delegated", methods: ["GET", "POST"] },
  "payments/test/verify": { kind: "delegated", methods: ["POST"] },
  "payments/test/webhook": { kind: "delegated", methods: ["POST"] },
  "preferences": { kind: "session", methods: ["GET", "POST"], why: "session: RLS client (the owner's own preferences)" },
  "privacy-requests": { kind: "session", methods: ["GET", "POST"], why: "session: RLS client (the user's own requests)" },
  "privacy-requests/operator": { kind: "session", methods: ["GET", "PATCH"], why: "session: privacy_request_operator_allowed (a user-ID grant table, #1723)" },
  "prospect/claim": { kind: "session", methods: ["POST"], why: "session client; business_transfer_claim/decline check auth.uid() is the invited, confirmed email" },
  "prospect/transfer": { kind: "session", methods: ["DELETE", "POST"], why: "prospect account + owner_id = caller via RLS client; the admin RPCs re-check owner_id = p_from_user_id" },
  "results-card": { kind: "owner", methods: ["GET", "POST"] },
  "spend-limits": { kind: "session", methods: ["POST"], why: "session: business from getPrimaryBusiness(), never from input" },
  "whatsapp/webhook": { kind: "webhook", methods: ["GET", "POST"] },
};

/** The payment handlers the delegated routes call: each checks ownership for the owner's calls and the signature for webhooks. */
const DELEGATES = ["src/lib/payments/production-checkout.ts", "src/lib/payments/test-checkout.ts"];

const API = "src/app/api";
function routeFiles(dir = API): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}
const routeOf = (path: string) => path.slice(API.length + 1, -"/route.ts".length);
const methodsOf = (source: string) => [...new Set([...source.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]))].sort();

/** `import { ownedManagedAttempt as ownedAttempt }`: a call to the local name counts as the guard's. */
function withAliases(source: string): string {
  let text = source;
  for (const [, name, alias] of source.matchAll(/\b([A-Za-z_]\w*) as ([A-Za-z_]\w*)\b/g)) text = text.replace(new RegExp(`\\b${alias}\\(`, "g"), `${name}(`);
  return text;
}

/** Why a route's source doesn't match its entry; null when it does. */
export function routeProblem(route: string, source: string, entry: Entry | undefined): string | null {
  if (!entry) return `${route}: not classified; add it to ROUTES with its guard`;
  if (JSON.stringify(methodsOf(source)) !== JSON.stringify([...entry.methods].sort())) return `${route}: handlers ${methodsOf(source).join(",")} but listed ${entry.methods.join(",")}`;
  if ((entry.kind === "session" || entry.kind === "public") && !entry.why?.trim()) return `${route}: ${entry.kind} needs a why`;
  if (entry.kind !== "public" && !GUARD[entry.kind].test(withAliases(source))) return `${route}: ${entry.kind} but calls no ${entry.kind} guard`;
  return null;
}

describe("core: every /api route is classified and calls its guard (#1729)", () => {
  const files = routeFiles();

  it("lists every route, and only routes that exist", () => {
    const found = files.map(routeOf).sort();
    expect(found.filter((route) => !ROUTES[route])).toEqual([]);
    expect(Object.keys(ROUTES).filter((route) => !found.includes(route))).toEqual([]);
  });

  it("each route's handlers match, and its file calls its class's guard", () => {
    expect(files.map((path) => routeProblem(routeOf(path), readFileSync(path, "utf8"), ROUTES[routeOf(path)])).filter(Boolean)).toEqual([]);
  });

  it("the delegated payment handlers check ownership and webhook signatures themselves", () => {
    for (const path of DELEGATES) {
      const source = readFileSync(path, "utf8");
      expect(GUARD.owner.test(source) || /auth\.getUser\(/.test(source), path).toBe(true);
      expect(GUARD.webhook.test(source), path).toBe(true);
    }
  });

  it("would catch a planted unguarded route (self-check)", () => {
    const planted = "export const POST = observeRoute(\"/api/x\", \"POST\", async (req) => admin.from(\"leads\").select());";
    expect(routeProblem("x", planted, undefined)).toMatch(/not classified/);
    expect(routeProblem("x", planted, { kind: "owner", methods: ["POST"] })).toMatch(/calls no owner guard/);
    expect(routeProblem("x", planted, { kind: "session", methods: ["POST"] })).toMatch(/needs a why/);
    expect(routeProblem("x", planted, { kind: "cron", methods: ["GET"] })).toMatch(/handlers POST but listed GET/);
  });
});
