\set ON_ERROR_STOP on

do $$
begin
  if current_database() not like 'adbrain_brand_destination_test_%' then
    raise exception 'Run only in a disposable adbrain_brand_destination_test_* database';
  end if;
end
$$;

create table public.businesses (id integer primary key, phone text);
insert into public.businesses values (1, 'fixture-phone');

\ir ../../db/migrations/20261102_brand_default_destination.sql

do $$
begin
  assert (select phone = 'fixture-phone' and default_destination = 'whatsapp'
    from public.businesses where id = 1), 'Existing businesses must keep their phone and WhatsApp behavior';
  assert (select data_type = 'text' and is_nullable = 'NO'
    and column_default = '''whatsapp''::text'
    from information_schema.columns where table_schema = 'public'
    and table_name = 'businesses' and column_name = 'default_destination'),
    'Brand destination must be non-null text with a WhatsApp default';
  assert (select atthasmissing from pg_attribute where attrelid = 'public.businesses'::regclass
    and attname = 'default_destination'), 'Existing rows must use the metadata-only default, not a rewrite';
end
$$;

insert into public.businesses (id) values (2);
insert into public.businesses (id, default_destination) values (3, 'website'), (4, 'whatsapp');
update public.businesses set default_destination = 'website' where id = 1;

do $$
declare invalid text;
begin
  assert (select default_destination = 'whatsapp' from public.businesses where id = 2),
    'Omitting the destination must preserve the WhatsApp default';
  assert (select phone is null and default_destination = 'website' from public.businesses where id = 3),
    'A website-only business must not need a dummy phone';
  foreach invalid in array array['', 'unknown', 'Website', ' whatsapp'] loop
    begin
      insert into public.businesses (id, default_destination) values (5, invalid);
      raise exception 'Invalid destination accepted: %', invalid;
    exception when check_violation then
      null;
    end;
  end loop;
  begin
    insert into public.businesses (id, default_destination) values (5, null);
    raise exception 'Null destination accepted';
  exception when not_null_violation then
    null;
  end;
  begin
    update public.businesses set default_destination = 'invalid' where id = 3;
    raise exception 'Invalid destination update accepted';
  exception when check_violation then
    null;
  end;
end
$$;

\ir ../../db/migrations/20261102_brand_default_destination.sql

do $$
begin
  assert (select count(*) = 4 from public.businesses), 'Reapply must preserve rows';
  assert (select phone = 'fixture-phone' and default_destination = 'website'
    from public.businesses where id = 1), 'Reapply must preserve the chosen destination and existing fields';
end
$$;
