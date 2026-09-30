create table if not exists public.preference_settings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  epoch bigint not null default 0 check (epoch >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, owner_id)
);

create table if not exists public.declared_preferences (
  business_id uuid not null,
  owner_id uuid not null,
  category text not null check (category in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow')),
  value text not null check (char_length(value) between 1 and 160),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, owner_id, category),
  foreign key (business_id, owner_id) references public.preference_settings(business_id, owner_id) on delete cascade
);

alter table public.preference_settings enable row level security;
alter table public.declared_preferences enable row level security;
revoke all on public.preference_settings, public.declared_preferences from public, anon, authenticated;
grant select on public.preference_settings, public.declared_preferences to authenticated;
create policy "preference settings: read own" on public.preference_settings for select to authenticated
  using (owner_id = auth.uid() and public.owns_business(business_id));
create policy "declared preferences: read own" on public.declared_preferences for select to authenticated
  using (owner_id = auth.uid() and public.owns_business(business_id));

create or replace function public.change_declared_preferences(
  p_business_id uuid, p_operation text, p_expected_epoch bigint,
  p_category text default null, p_value text default null
) returns bigint language plpgsql security definer set search_path = public
as $$
declare current_settings public.preference_settings;
begin
  if auth.uid() is null then raise exception 'Unauthenticated' using errcode = '42501'; end if;
  perform 1 from public.businesses where id = p_business_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Business unavailable' using errcode = '42501'; end if;
  if p_operation is null or p_operation not in ('enable', 'pause', 'save', 'forget', 'clear') then
    raise exception 'Invalid preference operation' using errcode = '22023';
  end if;
  insert into public.preference_settings (business_id, owner_id) values (p_business_id, auth.uid())
    on conflict do nothing;
  select * into current_settings from public.preference_settings
    where business_id = p_business_id and owner_id = auth.uid() for update;
  if current_settings.epoch is distinct from p_expected_epoch then
    raise exception 'Preferences changed; reload before saving' using errcode = '40001';
  end if;
  if p_operation = 'save' then
    if not current_settings.enabled then raise exception 'Preferences are paused' using errcode = '22023'; end if;
    if p_category is null or p_category not in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow')
      or p_value is null or char_length(trim(p_value)) not between 1 and 160
      or p_value ~ '[[:cntrl:]]' or p_value like '%' || chr(8377) || '%'
      or p_value ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{6,}|[$][0-9]|api[_ -]?key|password|secret|token|budget|spend|inr|rupees|per day|daily|weekly|monthly|city|location|target|service area|deadline|offer|discount|guarantee|price|approval|activate|religion|ethnicity|medical|health condition|credit card|phone number|ignore (all|previous|system|developer)|system prompt|you must|override (rules|safety))' then
      raise exception 'Invalid preference content' using errcode = '22023';
    end if;
    if not exists (select 1 from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid() and category = p_category)
      and (select count(*) from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid()) >= 12 then
      raise exception 'Preference limit reached' using errcode = '22023';
    end if;
    insert into public.declared_preferences (business_id, owner_id, category, value)
      values (p_business_id, auth.uid(), p_category, trim(p_value))
      on conflict (business_id, owner_id, category) do update
        set value = excluded.value, version = declared_preferences.version + 1, updated_at = now();
  elsif p_operation = 'forget' then
    if p_category is null or p_category not in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow') then
      raise exception 'Invalid preference category' using errcode = '22023';
    end if;
    delete from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid() and category = p_category;
  elsif p_operation = 'clear' then
    delete from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid();
  elsif p_operation = 'pause' then
    update public.preference_settings set enabled = false where business_id = p_business_id and owner_id = auth.uid();
  elsif p_operation = 'enable' then
    update public.preference_settings set enabled = true where business_id = p_business_id and owner_id = auth.uid();
  end if;
  update public.preference_settings set epoch = epoch + 1, updated_at = now()
    where business_id = p_business_id and owner_id = auth.uid() returning epoch into current_settings.epoch;
  return current_settings.epoch;
end
$$;
revoke all on function public.change_declared_preferences(uuid, text, bigint, text, text) from public, anon, service_role;
grant execute on function public.change_declared_preferences(uuid, text, bigint, text, text) to authenticated;