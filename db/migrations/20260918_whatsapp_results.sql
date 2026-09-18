alter table public.campaign_results
  add column if not exists conversations bigint check (conversations >= 0),
  add column if not exists cost_per_conversation numeric(12, 2) check (cost_per_conversation >= 0);