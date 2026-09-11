import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Database schema invariants (db/schema.sql).
 *
 * The schema is applied by hand/CI to Supabase, so there's no live DB in tests.
 * Instead we assert the security- and correctness-critical properties of the
 * DDL itself: RLS on every table, ownership-scoped policies, an append-only
 * audit log, a locked-down rate-limit function, and idempotency. These guard
 * real regressions we've hit (a solar-only `vertical` check that broke every
 * non-solar signup; RLS accidentally missing on a new table).
 */

const SQL = readFileSync(
  join(process.cwd(), "db", "schema.sql"),
  "utf8",
).toLowerCase();

/** Tables that hold user data and must be ownership-scoped. */
const OWNED_TABLES = [
  "businesses",
  "brand_assets",
  "creatives",
  "campaigns",
  "campaign_drafts",
  "campaign_operations",
  "campaign_results",
  "ad_instructions",
  "audit_log",
  "leads",
  "spend_limits",
  "llm_usage_events",
] as const;

const ALL_TABLES = [...OWNED_TABLES, "profiles", "rate_limit_hits", "meta_connections"] as const;

describe("schema: tables", () => {
  it("creates every expected table", () => {
    for (const t of ALL_TABLES) {
      expect(SQL).toContain(`create table if not exists public.${t}`);
    }
  });

  it("is idempotent — every create is guarded", () => {
    // No bare `create table public.x` / `create index public.x` allowed.
    expect(SQL).not.toMatch(/create table public\./);
    expect(SQL).not.toMatch(/create (unique )?index [a-z_]+ on/);
  });

  it("re-creates policies safely (drop before create)", () => {
    const created = [...SQL.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
    const dropped = new Set(
      [...SQL.matchAll(/drop policy if exists "([^"]+)"/g)].map((m) => m[1]),
    );
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) expect(dropped).toContain(name);
  });
});

describe("schema: row-level security", () => {
  it("enables RLS on every table", () => {
    for (const t of ALL_TABLES) {
      expect(SQL).toContain(`alter table public.${t} enable row level security`);
    }
  });

  it("gives every user-data table at least one policy", () => {
    for (const t of OWNED_TABLES) {
      const policies = [
        ...SQL.matchAll(new RegExp(`create policy "[^"]+"\\s*\\n?\\s*on public\\.${t}\\b`, "g")),
      ];
      expect(policies.length, `${t} has no RLS policy`).toBeGreaterThan(0);
    }
  });

  it("keeps Meta connection metadata and private credentials server-only", () => {
    expect(SQL).toContain("revoke all on public.meta_connections from public, anon, authenticated");
    expect(SQL).toMatch(/revoke all on private\.meta_tokens from public, anon, authenticated/);
    expect(SQL).toMatch(/revoke all on private\.meta_connection_attempts from public, anon, authenticated/);
    expect(SQL).toContain("grant usage on schema private to service_role");
    expect(SQL).not.toContain("create table if not exists public.meta_credentials");
    expect(SQL).not.toContain("access_token     text");
  });

  it("protects Meta private-storage RPCs with a pinned definer boundary", () => {
    const functions = [
      "meta_token_insert",
      "meta_token_get",
      "meta_token_delete",
      "meta_attempt_create",
      "meta_attempt_claim",
      "meta_attempt_get",
      "meta_attempt_set_discovering",
      "meta_attempt_attach_token",
      "meta_attempt_action_required",
      "meta_attempt_failed",
      "meta_attempt_cancelled",
      "meta_attempt_commit_selection",
      "meta_revoke_subject",
    ];
    for (const name of functions) {
      const start = SQL.indexOf(`function public.${name}`);
      expect(start, `${name} is missing`).toBeGreaterThan(-1);
      const body = SQL.slice(start, SQL.indexOf("$$", start));
      expect(body, `${name} must be SECURITY DEFINER`).toContain("security definer");
      expect(body, `${name} must pin search_path`).toContain("set search_path = private, public");
      expect(SQL, `${name} must be included in the service-role grant list`).toContain(
        `'${name}'`,
      );
    }
    expect(SQL).toContain("grant execute on function %s to service_role");
    expect(SQL).toContain("revoke all on function %s from public, anon, authenticated, service_role");
  });

  it("claims each OAuth attempt only once", () => {
    const start = SQL.indexOf("function public.meta_attempt_claim");
    const opening = SQL.indexOf("$$", start);
    const end = SQL.indexOf("$$", opening + 2);
    const body = SQL.slice(start, end);
    expect(body).toContain("claimed_at is null");
    expect(body).not.toContain("coalesce(claimed_at, now())");
  });

  it("scopes ownership through owns_business()", () => {
    expect(SQL).toContain("create or replace function public.owns_business");
    // Every business-scoped table's policy references the ownership helper.
    for (const t of ["brand_assets", "creatives", "campaigns", "leads", "spend_limits"]) {
      const idx = SQL.indexOf(`on public.${t} for all`);
      expect(idx, `${t} missing "for all" policy`).toBeGreaterThan(-1);
      expect(SQL.slice(idx, idx + 400)).toContain("owns_business");
    }
  });

  it("leaves rate_limit_hits with RLS on and no policies (function-only access)", () => {
    expect(SQL).toContain("alter table public.rate_limit_hits enable row level security");
    expect(SQL).not.toMatch(/on public\.rate_limit_hits for/);
  });
});

describe("schema: audit_log is append-only", () => {
  it("allows select and insert but never update or delete", () => {
    expect(SQL).toContain("on public.audit_log for select");
    expect(SQL).toContain("on public.audit_log for insert");
    expect(SQL).not.toMatch(/on public\.audit_log for (update|delete|all)/);
  });
});

describe("schema: usage telemetry", () => {
  it("keeps text and image cost events queryable without raw content", () => {
    expect(SQL).toContain("usage_kind");
    expect(SQL).toContain("check (usage_kind in ('text', 'image'))");
    expect(SQL).toContain("estimated_cost_usd");
    expect(SQL).toContain("latency_ms");
    expect(SQL).toContain("image_width");
    expect(SQL).toContain("image_height");
    expect(SQL).toContain("metadata jsonb");
    expect(SQL).toContain("never store raw prompts");
  });
});

describe("schema: check_rate_limit function", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    const start = SQL.indexOf("create or replace function public.check_rate_limit");
    expect(start).toBeGreaterThan(-1);
    const body = SQL.slice(start, SQL.indexOf("$$;", start));
    expect(body).toContain("security definer");
    // Pinning search_path prevents schema-injection against a definer function.
    expect(body).toContain("set search_path = public");
  });

  it("is not executable by the public role but is granted to app roles", () => {
    expect(SQL).toContain(
      "revoke all on function public.check_rate_limit(text, integer, integer) from public",
    );
    expect(SQL).toMatch(
      /grant execute on function public\.check_rate_limit\(text, integer, integer\)\s*\n?\s*to authenticated, anon/,
    );
  });
});

describe("schema: constraints", () => {
  it("keeps `vertical` free text — no solar-only check (regression guard)", () => {
    // A `check (vertical in ('solar'))` broke every non-solar business on save.
    expect(SQL).not.toMatch(/check \(vertical/);
    expect(SQL).toContain("drop constraint if exists businesses_vertical_check");
    expect(SQL).toContain("vertical        text not null default 'local business'");
  });

  it("bounds spend_limits.alert_pct to a percentage", () => {
    expect(SQL).toMatch(/alert_pct\s+integer not null default 80 check \(alert_pct between 1 and 100\)/);
  });

  it("allows one safe Meta connection per business", () => {
    expect(SQL).toContain("create table if not exists public.meta_connections");
    expect(SQL).toContain("business_id          uuid primary key");
    expect(SQL).toContain("foreign key (business_id, token_id)");
  });

  it("consolidates durable campaign drafts, operations, and binding columns", () => {
    expect(SQL).toContain("create table if not exists public.campaign_drafts");
    expect(SQL).toContain("create table if not exists public.campaign_operations");
    expect(SQL).toContain("add column if not exists meta_ad_account_id text");
    expect(SQL).toContain("add column if not exists meta_page_id text");
    expect(SQL).toContain("add column if not exists meta_connection_generation bigint");
    expect(SQL).toContain("create or replace function public.update_campaign_draft_if_version");
    expect(SQL).toContain("create or replace function public.claim_campaign_operation");
    expect(SQL).toContain("create or replace function public.checkpoint_campaign_operation");
    expect(SQL).toContain("create or replace function public.finish_campaign_operation");
  });

  it("dedupes leads per business", () => {
    expect(SQL).toMatch(/unique \(business_id, meta_lead_id\)/);
  });

  it("cascades child rows when a business is deleted", () => {
    for (const t of ["brand_assets", "creatives", "campaigns", "leads"]) {
      const idx = SQL.indexOf(`create table if not exists public.${t}`);
      const body = SQL.slice(idx, SQL.indexOf(");", idx));
      expect(body, `${t} should cascade from businesses`).toContain(
        "references public.businesses (id) on delete cascade",
      );
    }
  });
});

describe("schema: storage", () => {
  it("creates both buckets idempotently", () => {
    for (const bucket of ["brand-assets", "creatives"]) {
      expect(SQL).toContain(`values ('${bucket}', '${bucket}', true)`);
    }
    expect(SQL).toContain("on conflict (id) do nothing");
  });

  it("scopes object access to a business folder the user owns", () => {
    const policies = [...SQL.matchAll(/on storage\.objects for (select|insert|update|delete)/g)];
    expect(policies.length).toBeGreaterThanOrEqual(6);
    // Every storage policy keys off the first path segment = business id.
    const occurrences = [...SQL.matchAll(/storage\.foldername\(name\)\)\[1\]\)::uuid/g)];
    expect(occurrences.length).toBeGreaterThanOrEqual(policies.length);
  });
});
