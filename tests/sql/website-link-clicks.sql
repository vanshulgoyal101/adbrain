\set ON_ERROR_STOP on

do $$
begin
  if current_database() not like 'adbrain_link_clicks_test_%' then
    raise exception 'Run only in a disposable adbrain_link_clicks_test_* database';
  end if;
end
$$;

create table public.campaign_results (id integer primary key, clicks bigint not null);
insert into public.campaign_results values (1, 17);

\ir ../../db/migrations/20261102_website_link_clicks.sql

do $$
begin
  assert (select clicks = 17 and link_clicks is null from public.campaign_results where id = 1),
    'Existing clicks must survive and unread link clicks must stay null';
  assert (select data_type = 'bigint' and is_nullable = 'YES' and column_default is null
    from information_schema.columns where table_schema = 'public'
    and table_name = 'campaign_results' and column_name = 'link_clicks'),
    'Link clicks must be nullable bigint without a default';
end
$$;

insert into public.campaign_results (id, clicks, link_clicks)
values (2, 0, null), (3, 0, 0), (4, 0, 9007199254740991);

do $$
declare invalid bigint;
begin
  foreach invalid in array array[-1::bigint, 9007199254740992::bigint] loop
    begin
      insert into public.campaign_results values (5, 0, invalid);
      raise exception 'Invalid link clicks accepted: %', invalid;
    exception when check_violation then
      null;
    end;
  end loop;
end
$$;

\ir ../../db/migrations/20261102_website_link_clicks.sql

do $$
begin
  assert (select count(*) = 4 from public.campaign_results), 'Reapply must preserve rows';
  assert (select link_clicks = 9007199254740991 from public.campaign_results where id = 4),
    'Reapply must preserve the safe-integer upper bound';
end
$$;
