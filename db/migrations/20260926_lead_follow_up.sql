alter table public.leads
  add column if not exists workflow_status text not null default 'new'
    check (workflow_status in ('new', 'contacted', 'qualified', 'booked', 'closed')),
  add column if not exists follow_up_note text not null default ''
    check (char_length(follow_up_note) <= 2000);

create index if not exists leads_inbox_cursor_idx
  on public.leads (business_id, created_time desc nulls last, id);
create index if not exists leads_workflow_idx
  on public.leads (business_id, workflow_status);

create or replace function public.get_lead_page(
  p_business_id uuid, p_query text default '', p_status text default 'all',
  p_contact text default 'all', p_sort text default 'newest', p_limit integer default 50,
  p_after_id uuid default null, p_after_key text default '', p_after_null boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare result jsonb;
begin
  if not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_query is null or char_length(p_query) > 200
    or p_status is null or p_status not in ('all', 'new', 'contacted', 'qualified', 'booked', 'closed')
    or p_contact is null or p_contact not in ('all', 'ready', 'missing')
    or p_sort is null or p_sort not in ('newest', 'oldest', 'name')
    or p_after_key is null or p_after_null is null then
    raise invalid_parameter_value using message = 'Invalid enquiry filters';
  end if;
  with matching as materialized (
    select lead as record,
      case when p_sort = 'name' then coalesce(lower(lead.full_name), '')
        else coalesce(to_char(lead.created_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '') end collate "C" as sort_key,
      case when p_sort = 'name' then lead.full_name is null else lead.created_time is null end as missing_key
    from public.leads lead
    where lead.business_id = p_business_id
      and (p_status = 'all' or lead.workflow_status = p_status)
      and (p_query = '' or strpos(lower(concat_ws(' ', lead.full_name, lead.phone, lead.email, lead.city, lead.form_name)), lower(p_query)) > 0)
      and (p_contact = 'all' or
        (coalesce(btrim(lead.phone), '') <> '' or coalesce(btrim(lead.email), '') <> '') = (p_contact = 'ready'))
  ), candidates as (
    select * from matching
    where p_after_id is null or missing_key > p_after_null
      or (missing_key = p_after_null and (
        case when p_sort = 'newest' then sort_key < p_after_key collate "C"
          else sort_key > p_after_key collate "C" end
        or (sort_key = p_after_key collate "C" and (record).id > p_after_id)))
  ), numbered as (
    select *, row_number() over (order by missing_key,
      case when p_sort = 'newest' then sort_key end desc,
      case when p_sort <> 'newest' then sort_key end asc, (record).id) as position
    from candidates
    order by missing_key,
      case when p_sort = 'newest' then sort_key end desc,
      case when p_sort <> 'newest' then sort_key end asc, (record).id
    limit p_limit + 1
  )
  select jsonb_build_object(
    'leads', coalesce((select jsonb_agg(to_jsonb(record) order by position) from numbered where position <= p_limit), '[]'::jsonb),
    'total', (select count(*) from matching),
    'nextCursor', case when exists (select 1 from numbered where position > p_limit)
      then (select jsonb_build_object('id', (record).id, 'key', sort_key, 'missing', missing_key)
        from numbered where position = p_limit) else null end
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_lead_page(uuid, text, text, text, text, integer, uuid, text, boolean) from public, anon;
grant execute on function public.get_lead_page(uuid, text, text, text, text, integer, uuid, text, boolean) to authenticated;