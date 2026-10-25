begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #588: the learning ledger. One row per launched campaign: what we tried (a settings snapshot taken
-- at launch: destination, prefill text and language, audience, formats, budget, creatives and the
-- models that made them) and, filled in by QA 2, the hypothesis it tests and the verdict. Outcomes
-- are read from campaign_results at query time (npm run stats -- learnings), never copied here.
-- IDs, settings and short text only: no lead personal data, never tokens. Owners read their own
-- rows; only the service role writes.
create table if not exists public.campaign_learnings (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 16384),
  hypothesis text check (char_length(hypothesis) between 1 and 500),
  verdict text check (char_length(verdict) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_learnings_business on public.campaign_learnings(business_id, created_at desc);

alter table public.campaign_learnings enable row level security;
revoke all on public.campaign_learnings from public, anon, authenticated, service_role;
grant select on public.campaign_learnings to authenticated;
grant select, insert, update on public.campaign_learnings to service_role;

drop policy if exists "campaign learnings: read own" on public.campaign_learnings;
create policy "campaign learnings: read own" on public.campaign_learnings
  for select to authenticated using (public.owns_business(business_id));

commit;
