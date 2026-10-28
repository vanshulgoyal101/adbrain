begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1684: an order sent to review_required (amount mismatch, second capture, shared payment, excess refund, dispute)
-- holds the customer's money until an operator refunds it. Count those so the scheduled health check alerts DevOps.
-- review_required never clears, so "still held" is: captured and not fully refunded. Counts only; no identifiers.
create or replace function public.production_payment_webhook_health(p_account_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'events7d', (select count(*) from private.production_payment_events
      where account_id = p_account_id and received_at > clock_timestamp() - interval '7 days'),
    'unprocessed', (select count(*) from private.production_payment_events
      where account_id = p_account_id and processed_at is null and received_at < clock_timestamp() - interval '1 hour'),
    'capturedWithoutEvent', (select count(*) from private.production_payment_orders payment
      where payment.account_id = p_account_id and payment.captured_paise > 0
        and payment.updated_at < clock_timestamp() - interval '30 minutes'
        and not exists(select 1 from private.production_payment_events event
          where event.account_id = payment.account_id and event.payment_id = payment.payment_id and event.kind = 'capture')),
    'reviewRequired', (select count(*) from private.production_payment_orders payment
      where payment.account_id = p_account_id and payment.review_required
        and payment.captured_paise > 0 and payment.refunded_paise < payment.amount_paise));
$$;

revoke all on function public.production_payment_webhook_health(text) from public, anon, authenticated;
grant execute on function public.production_payment_webhook_health(text) to service_role;
commit;
