-- #757: Meta can stop accepting a token with no deauthorize callback (password change, security
-- checkpoint, a permission removed). The first Graph 190 marks the connection reauth_required, so the
-- app shows it as needing Facebook again. Only the generation that failed is changed, never a newer one.
create or replace function public.meta_connection_mark_reauth(p_business_id uuid, p_generation bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.meta_connections
  set authorization_status = 'reauth_required', updated_at = now()
  where business_id = p_business_id and generation = p_generation and authorization_status = 'connected';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.meta_connection_mark_reauth(uuid, bigint) from public, anon, authenticated;
grant execute on function public.meta_connection_mark_reauth(uuid, bigint) to service_role;
