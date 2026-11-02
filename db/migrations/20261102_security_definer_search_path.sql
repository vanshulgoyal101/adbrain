-- The migration runner wraps these statements and the ledger update together.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter function public.append_verified_audit_event(uuid, uuid, text, text, text, text, text, jsonb, text) set search_path = '';
alter function public.change_declared_preferences(uuid, text, bigint, text, text) set search_path = '';
alter function public.check_rate_limit(text, integer, integer) set search_path = '';
alter function public.delete_campaign_draft_if_version(uuid, bigint) set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.meta_attempt_action_required(uuid, jsonb) set search_path = '';
alter function public.meta_attempt_attach_token(uuid, uuid) set search_path = '';
alter function public.meta_attempt_cancelled(uuid) set search_path = '';
alter function public.meta_attempt_claim(text, uuid, text) set search_path = '';
alter function public.meta_attempt_commit_selection(uuid, uuid, text, bigint, boolean) set search_path = '';
alter function public.meta_attempt_create(uuid, uuid, uuid, text, text, text, jsonb, bigint, timestamp with time zone) set search_path = '';
alter function public.meta_attempt_discovery_result(uuid, jsonb, text, text) set search_path = '';
alter function public.meta_attempt_failed(uuid, text) set search_path = '';
alter function public.meta_attempt_get(uuid, uuid) set search_path = '';
alter function public.meta_attempt_retry_claim(uuid, uuid, bigint) set search_path = '';
alter function public.meta_attempt_set_discovering(uuid, boolean) set search_path = '';
alter function public.meta_disconnect(uuid, uuid) set search_path = '';
alter function public.meta_revoke_subject(text) set search_path = '';
alter function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamp with time zone) set search_path = '';

revoke execute on function private.creative_generation_reconciliation_guard(),
  private.creative_generation_settled_write_guard() from public;
