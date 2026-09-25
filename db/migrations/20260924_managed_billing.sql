create table if not exists public.meta_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null check (environment in ('test', 'live')),
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]+$'),
  owner_business_id text not null check (owner_business_id ~ '^[0-9]+$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, environment),
  unique (ad_account_id, environment)
);

alter table public.meta_billing_profiles enable row level security;
revoke all on public.meta_billing_profiles from public, anon, authenticated, service_role;
grant select on public.meta_billing_profiles to authenticated;
grant select, insert on public.meta_billing_profiles to service_role;
drop policy if exists "meta billing: read own" on public.meta_billing_profiles;
create policy "meta billing: read own" on public.meta_billing_profiles
  for select to authenticated using (public.owns_business(business_id));

create table if not exists public.meta_funding_evidence (
  id uuid primary key,
  profile_id uuid not null references public.meta_billing_profiles(id) on delete restrict,
  verified_by uuid not null references auth.users(id) on delete restrict,
  source text not null check (source in ('provider_verification', 'operator_review', 'test_fixture')),
  source_reference uuid not null,
  verified_at timestamptz not null,
  record jsonb not null check (
    jsonb_typeof(record) = 'object' and octet_length(record::text) <= 16384
    and record - array['version', 'businessId', 'environment', 'connectionGeneration', 'evidenceId',
      'verifiedAt', 'expiresAt', 'revokedAt', 'setup'] = '{}'::jsonb
  ),
  created_at timestamptz not null default now()
);
create index if not exists meta_funding_evidence_profile_idx
  on public.meta_funding_evidence(profile_id, verified_at desc, created_at desc, id desc);
alter table public.meta_funding_evidence enable row level security;
revoke all on public.meta_funding_evidence from public, anon, authenticated, service_role;
grant select, insert on public.meta_funding_evidence to service_role;

create or replace function public.validate_meta_funding_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile public.meta_billing_profiles;
  verified_at timestamptz;
  expires_at timestamptz;
begin
  select * into strict profile from public.meta_billing_profiles where id = new.profile_id;
  if new.record->>'version' is distinct from '1'
    or new.record->>'evidenceId' is distinct from new.id::text
    or new.record->>'businessId' is distinct from profile.business_id::text
    or new.record->>'environment' is distinct from profile.environment
    or new.record#>>'{setup,accountId}' is distinct from profile.ad_account_id
    or new.record#>>'{setup,expectedOwnerBusinessId}' is distinct from profile.owner_business_id
    or new.record#>>'{setup,ownerBusinessId}' is distinct from profile.owner_business_id
    or new.record->'revokedAt' is distinct from 'null'::jsonb
    or (new.source = 'test_fixture' and profile.environment <> 'test')
    or jsonb_typeof(new.record->'setup') is distinct from 'object'
    or (new.record->'setup') - array['method', 'accountId', 'expectedOwnerBusinessId', 'ownerBusinessId',
      'currency', 'country', 'accountActive', 'billingMode', 'paymentMethod', 'recurringAuthorisation',
      'spendControls', 'ownerAcceptedMetaInitiatedPayments'] <> '{}'::jsonb
    or jsonb_typeof(new.record->'connectionGeneration') is distinct from 'number'
    or (new.record->>'connectionGeneration') !~ '^[0-9]+$'
    or (new.record->>'connectionGeneration')::numeric > 9007199254740991
  then
    raise exception 'Funding evidence does not match its billing profile' using errcode = '23514';
  end if;
  verified_at := (new.record->>'verifiedAt')::timestamptz;
  expires_at := (new.record->>'expiresAt')::timestamptz;
  if verified_at is null or expires_at is null or not isfinite(verified_at) or not isfinite(expires_at)
    or verified_at > clock_timestamp() or expires_at <= verified_at then
    raise exception 'Funding evidence timestamps are invalid' using errcode = '23514';
  end if;
  new.verified_at := verified_at;
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.validate_meta_funding_evidence() from public, anon, authenticated, service_role;
drop trigger if exists validate_meta_funding_evidence on public.meta_funding_evidence;
create trigger validate_meta_funding_evidence before insert on public.meta_funding_evidence
  for each row execute function public.validate_meta_funding_evidence();

create table if not exists public.meta_funding_revocations (
  evidence_id uuid primary key references public.meta_funding_evidence(id) on delete restrict,
  revoked_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (reason in ('mandate_revoked', 'account_changed', 'evidence_invalid', 'operator_hold')),
  revoked_at timestamptz not null default now()
);
alter table public.meta_funding_revocations enable row level security;
revoke all on public.meta_funding_revocations from public, anon, authenticated, service_role;
grant select, insert on public.meta_funding_revocations to service_role;

create or replace function public.stamp_meta_funding_revocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revoked_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_meta_funding_revocation() from public, anon, authenticated, service_role;
drop trigger if exists stamp_meta_funding_revocation on public.meta_funding_revocations;
create trigger stamp_meta_funding_revocation before insert on public.meta_funding_revocations
  for each row execute function public.stamp_meta_funding_revocation();

create or replace function public.meta_funding_latest_record(p_business_id uuid, p_environment text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select evidence.record || jsonb_build_object('revokedAt',
    case when invalidation.revoked_at >= evidence.verified_at
      then to_char(invalidation.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else null end)
  from public.meta_billing_profiles profile
  join lateral (
    select * from public.meta_funding_evidence
    where profile_id = profile.id
    order by verified_at desc, created_at desc, id desc limit 1
  ) evidence on true
  left join lateral (
    select max(revocation.revoked_at) as revoked_at
    from public.meta_funding_revocations revocation
    join public.meta_funding_evidence previous on previous.id = revocation.evidence_id
    where previous.profile_id = profile.id
  ) invalidation on true
  where profile.business_id = p_business_id and profile.environment = p_environment;
$$;
revoke all on function public.meta_funding_latest_record(uuid, text) from public, anon, authenticated;
grant execute on function public.meta_funding_latest_record(uuid, text) to service_role;