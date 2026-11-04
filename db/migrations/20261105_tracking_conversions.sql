-- #2711: the runner owns the transaction so the schema and checksum commit together.
-- Existing rows read zero conversions and a NULL value; no existing data is rewritten.
alter table public.businesses
  add column if not exists meta_pixel_id text;

alter table public.campaigns
  add column if not exists meta_pixel_id text;

alter table public.campaign_results
  add column if not exists conversions bigint not null default 0,
  add column if not exists conversion_value numeric(14, 2);

alter table public.ad_results
  add column if not exists conversions bigint not null default 0,
  add column if not exists conversion_value numeric(14, 2);

do $tracking_columns$
declare
  incompatible text;
begin
  select string_agg(format('%I.%I', expected.table_name, expected.column_name), ', '
                    order by expected.table_name, expected.column_name)
    into incompatible
  from (values
    ('businesses', 'meta_pixel_id', 'text', false),
    ('campaigns', 'meta_pixel_id', 'text', false),
    ('campaign_results', 'conversions', 'bigint', true),
    ('campaign_results', 'conversion_value', 'numeric(14,2)', false),
    ('ad_results', 'conversions', 'bigint', true),
    ('ad_results', 'conversion_value', 'numeric(14,2)', false)
  ) as expected(table_name, column_name, data_type, required)
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid
    and c.relname = expected.table_name and c.relkind in ('r', 'p')
  left join pg_catalog.pg_attribute a on a.attrelid = c.oid
    and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where a.attnum is null
    or pg_catalog.format_type(a.atttypid, a.atttypmod) <> expected.data_type
    or a.attnotnull is distinct from expected.required
    or (expected.column_name = 'conversions'
        and (d.oid is null or pg_catalog.pg_get_expr(d.adbin, d.adrelid) not in ('0', '0::bigint', '(0)::bigint')))
    or (expected.column_name <> 'conversions' and d.oid is not null);
  if incompatible is not null then
    raise exception 'Tracking migration incompatible columns: %', incompatible;
  end if;
end
$tracking_columns$;

alter table public.campaign_results drop constraint if exists campaign_results_conversions_safe;
alter table public.campaign_results add constraint campaign_results_conversions_safe
  check (conversions between 0 and 9007199254740991);
alter table public.campaign_results drop constraint if exists campaign_results_conversion_value_check;
alter table public.campaign_results add constraint campaign_results_conversion_value_check
  check (conversion_value >= 0 and conversion_value <> 'NaN'::numeric);

alter table public.ad_results drop constraint if exists ad_results_conversions_safe;
alter table public.ad_results add constraint ad_results_conversions_safe
  check (conversions between 0 and 9007199254740991);
alter table public.ad_results drop constraint if exists ad_results_conversion_value_check;
alter table public.ad_results add constraint ad_results_conversion_value_check
  check (conversion_value >= 0 and conversion_value <> 'NaN'::numeric);
