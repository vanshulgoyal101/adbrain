begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- #359: Supabase advisor hardening. Same access rules, fewer ways in, faster RLS.

-- owns_business only reads the caller's own businesses, which businesses RLS already allows,
-- so it needs no definer rights. As SECURITY INVOKER it returns the same answer for every
-- role (service_role bypasses RLS; inside definer RPCs it runs as their owner, as before).
alter function public.owns_business(uuid) security invoker;

-- handle_new_user is the auth.users insert trigger only; triggers don't need EXECUTE.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Fixed search path; now() resolves through pg_catalog.
alter function public.set_updated_at() set search_path = '';

-- auth.uid() once per statement instead of once per row (auth_rls_initplan). Same predicates.
alter policy "businesses: all own" on public.businesses
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy "campaign drafts: own business" on public.campaign_drafts
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id) and owner_id = (select auth.uid()));
alter policy "declared preferences: read own" on public.declared_preferences
  using (owner_id = (select auth.uid()) and public.owns_business(business_id));
alter policy "preference settings: read own" on public.preference_settings
  using (owner_id = (select auth.uid()) and public.owns_business(business_id));
alter policy "privacy requests: read own" on public.privacy_requests
  using (owner_id = (select auth.uid()));
alter policy "privacy requests: submit own" on public.privacy_requests
  with check (owner_id = (select auth.uid()) and status = 'received');
alter policy "profiles: select own" on public.profiles using (id = (select auth.uid()));
alter policy "profiles: update own" on public.profiles using (id = (select auth.uid()));

-- Tenant foreign keys that are queried or cascaded by that key.
create index if not exists leads_business_campaign_idx on public.leads (business_id, campaign_id);
create index if not exists campaign_operations_campaign_idx on public.campaign_operations (campaign_id);
create index if not exists campaign_operations_business_campaign_idx on public.campaign_operations (business_id, campaign_id);
create index if not exists campaign_operations_business_draft_idx on public.campaign_operations (business_id, draft_id);
create index if not exists meta_connections_business_token_idx on public.meta_connections (business_id, token_id);
commit;
