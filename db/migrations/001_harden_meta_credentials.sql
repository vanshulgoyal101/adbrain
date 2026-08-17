-- ════════════════════════════════════════════════════════════════════════
--  Migration: harden meta_credentials so the client role can never read tokens
--  Apply after db/schema.sql. Fold into schema.sql when convenient.
--
--  Why: meta_credentials has an RLS policy `for all` with owns_business, so the
--  authenticated client role could SELECT its own `access_token`. Server code
--  reads creds with the service-role key (bypasses RLS + grants), so the
--  authenticated/anon roles need no direct access to this sensitive table.
--
--  PRECHECK: confirm every credential read in src/lib/meta/credentials.ts uses
--  the admin/service-role client (src/lib/supabase/admin.ts). If any path reads
--  creds with the *user* client, switch it to admin BEFORE applying, or the
--  Facebook-Login connect flow will break.
-- ════════════════════════════════════════════════════════════════════════

revoke select on public.meta_credentials from anon, authenticated;

-- Expose only non-secret connection *status* to the client, scoped to the caller.
create or replace function public.meta_connection_status(p_business_id uuid)
returns table (connected boolean, ad_account_id text, page_id text, scopes text)
language sql
security definer
set search_path = public
as $$
  select true, mc.ad_account_id, mc.page_id, mc.scopes
  from public.meta_credentials mc
  where mc.business_id = p_business_id
    and public.owns_business(mc.business_id)
$$;
