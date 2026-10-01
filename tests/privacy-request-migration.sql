\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
\ir ../db/migrations/20260930_privacy_requests.sql
\ir ../db/migrations/20260930_privacy_requests.sql

insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
insert into public.privacy_requests(owner_id,kind) values ('11111111-1111-4111-8111-111111111111','export');
do $$ begin
  if (select count(*) from public.privacy_requests) <> 1 then raise exception 'Owner cannot read request'; end if;
  begin
    insert into public.privacy_requests(owner_id,kind) values ('22222222-2222-4222-8222-222222222222','delete');
    raise exception 'Cross-owner insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.privacy_requests(owner_id,kind,status) values ('11111111-1111-4111-8111-111111111111','delete','completed');
    raise exception 'Customer status injection allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.privacy_requests set status='completed';
    raise exception 'Customer status update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.privacy_requests(owner_id,kind) values ('11111111-1111-4111-8111-111111111111','export');
    raise exception 'Duplicate open request allowed';
  exception when unique_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$ begin
  if (select count(*) from public.privacy_requests) <> 0 then raise exception 'Cross-owner read allowed'; end if;
end $$;
set role anon;
do $$ begin
  begin
    perform 1 from public.privacy_requests;
    raise exception 'Anonymous request read allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
set role service_role;
do $$ begin
  if public.privacy_request_operator_allowed('11111111-1111-4111-8111-111111111111') then raise exception 'Unregistered operator allowed'; end if;
end $$;
reset role;
insert into private.privacy_request_operators(user_id) values ('11111111-1111-4111-8111-111111111111');
set role service_role;
do $$ begin
  if not public.privacy_request_operator_allowed('11111111-1111-4111-8111-111111111111') then raise exception 'Operator not authorized'; end if;
  if has_table_privilege('authenticated', 'public.privacy_requests', 'UPDATE') then raise exception 'Customer update grant leaked'; end if;
end $$;
update public.privacy_requests set status='in_review',handled_by='11111111-1111-4111-8111-111111111111',updated_at=now();
reset role;
update private.privacy_request_operators set revoked_at=now();
set role service_role;
do $$ begin
  if public.privacy_request_operator_allowed('11111111-1111-4111-8111-111111111111') then raise exception 'Revoked operator allowed'; end if;
end $$;