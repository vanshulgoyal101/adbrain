begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #773: the envelope of an edit to a launched campaign (audience now, budget in #774). Kept apart from
-- campaign_operations, whose readers (reconciliation, the core scoreboard, the operations list) treat
-- every row as a launch with a draft. One row per (campaign, idempotency key): the key is the campaign
-- plus a digest of the change, so a retry of the same change replays instead of repeating it.
-- `phase` is how far the edit got (validate -> edit -> mirror -> complete); `transmitted` turns true
-- right before the first Meta write, so "nothing was sent" is a recorded fact. `before` and `change`
-- are audience/budget settings only; `sanitized_error` is a client-safe message. No tokens, no lead data.
-- Owners read their own rows; only the service role writes.
create table if not exists public.campaign_edit_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null check (kind in ('audience', 'budget')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'succeeded', 'failed', 'needs_reconciliation')),
  phase text not null default 'validate' check (phase in ('validate', 'edit', 'mirror', 'complete')),
  transmitted boolean not null default false,
  before jsonb check (before is null or octet_length(before::text) <= 65536),
  change jsonb check (change is null or octet_length(change::text) <= 65536),
  result jsonb check (result is null or octet_length(result::text) <= 65536),
  sanitized_error text check (char_length(sanitized_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, campaign_id, idempotency_key)
);
create index if not exists campaign_edit_operations_campaign on public.campaign_edit_operations(campaign_id, created_at desc);

alter table public.campaign_edit_operations enable row level security;
revoke all on public.campaign_edit_operations from public, anon, authenticated, service_role;
grant select on public.campaign_edit_operations to authenticated;
grant select, insert, update on public.campaign_edit_operations to service_role;

drop policy if exists "campaign edit operations: read own" on public.campaign_edit_operations;
create policy "campaign edit operations: read own" on public.campaign_edit_operations
  for select to authenticated using (public.owns_business(business_id));

commit;
