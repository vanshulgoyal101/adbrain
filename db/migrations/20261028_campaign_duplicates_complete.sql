-- #1138: a Meta campaign belongs to one AdBrain business (#1057: the one that launched it, else the first to
-- import it). Rows other businesses hold for it (from before #1062, or concurrent syncs) can no longer write to
-- Meta (#1165); this ends them so their owners stop seeing dead cards. Data only: no column, index or table
-- change, and no unique index on meta_campaign_id (it would fail a launch whose campaign was imported first).
-- Idempotent: an already-ended row is left alone. Restore: set status back from raw->>'statusBeforeDuplicate'.
begin;
set local lock_timeout = '5s';

with claims as (
  select id, business_id, status,
    first_value(business_id) over (
      partition by meta_campaign_id
      order by (raw->>'source' = 'campaign_operation') desc nulls last, created_at, id
    ) as owner
  from public.campaigns
  where meta_campaign_id is not null
)
update public.campaigns c
set status = 'completed',
    raw = coalesce(c.raw, '{}'::jsonb) || jsonb_build_object('duplicateOf', claims.owner, 'statusBeforeDuplicate', c.status)
from claims
where claims.id = c.id and c.business_id <> claims.owner and c.status <> 'completed';

commit;
