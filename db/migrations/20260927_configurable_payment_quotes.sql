create or replace function private.production_payment_quote(p_amount bigint,p_verification boolean default false)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_amount between 100 and 1000000 and p_verification is not null then
    jsonb_build_object('version',case when p_verification then 'inr-payment-verification-v1'
      when p_amount=1000000 then 'inr-annual-total-v1' else 'inr-annual-configurable-v1' end,
      'merchantDisplay','Vanshul Goyal','currency','INR','totalPaise',p_amount,
      'serviceAllocationPaise',case when p_verification then 0 else p_amount/5 end,
      'metaAllocationPaise',case when p_verification then 0 else p_amount-p_amount/5 end,
      'additionalCustomerTaxPaise',0,'metaTaxTreatment','included-in-meta-allocation',
      'gatewayFees','absorbed-by-adbrain','automaticRenewal',false)
      || case when p_verification then jsonb_build_object('verificationAllocationPaise',p_amount) else '{}'::jsonb end
    else null end;
$$;

create or replace function private.production_payment_rupees(p_amount bigint)
returns text language sql immutable set search_path = '' as $$
  select 'INR '||rtrim(rtrim(to_char(p_amount::numeric/100,'FM999,999,990.00'),'0'),'.');
$$;

create or replace function private.production_payment_priced_policy(p_quote jsonb,p_verification jsonb default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare service_scope text; refund_terms text;
begin
  if p_verification is not null then
    service_scope := 'One real '||private.production_payment_rupees((p_quote->>'totalPaise')::bigint)
      ||' payment to verify checkout for the selected internal pilot. This is not the annual service and grants no service or advertising allocation, renewal or ad activation. AdBrain absorbs gateway fees; no additional checkout charge applies.';
    refund_terms := 'This verification payment remains recorded separately from service and advertising funds. Refund requests are handled by the operator under applicable law; no automatic refund is initiated. Mandatory customer rights remain applicable.';
  else
    service_scope := private.production_payment_rupees((p_quote->>'totalPaise')::bigint)
      ||' total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. '
      ||private.production_payment_rupees((p_quote->>'serviceAllocationPaise')::bigint)||' is allocated to service and '
      ||private.production_payment_rupees((p_quote->>'metaAllocationPaise')::bigint)
      ||' to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.';
    refund_terms := 'Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The '
      ||private.production_payment_rupees((p_quote->>'serviceAllocationPaise')::bigint)
      ||' service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable.';
  end if;
  return jsonb_build_object('version','operator-managed-priced-v1','fundingMode','operator_managed',
    'approvalReference','https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5858162341',
    'approvedAt','2026-09-27T17:36:03Z','serviceScope',service_scope,
    'invoiceTerms','The invoice will reflect Vanshul Goyal''s actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.',
    'refundTerms',refund_terms,'quote',p_quote)
    || case when p_verification is not null then jsonb_build_object('verification',p_verification) else '{}'::jsonb end;
end;
$$;

create or replace function private.production_payment_contract_valid(p_amount bigint,p_quote jsonb,p_terms jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare verification boolean;
begin
  verification := coalesce(p_quote->>'version'='inr-payment-verification-v1',false);
  if p_quote is distinct from private.production_payment_quote(p_amount,verification)
    or p_amount is null or jsonb_typeof(p_quote)<>'object' then return false; end if;
  if p_terms->>'version'='operator-managed-priced-v1' then
    if verification then
      if not ((jsonb_typeof(p_terms->'verification')='object'
        and (p_terms->'verification')-array['businessId','userId','expiresAt']='{}'::jsonb
        and (p_terms#>>'{verification,businessId}')::uuid is not null
        and (p_terms#>>'{verification,userId}')::uuid is not null
        and isfinite((p_terms#>>'{verification,expiresAt}')::timestamptz)) is true) then return false; end if;
    elsif p_terms ? 'verification' then return false;
    end if;
    return p_terms=private.production_payment_priced_policy(p_quote,case when verification then p_terms->'verification' else null end);
  end if;
  return not verification and p_quote=private.production_payment_quote(1000000,false);
exception when others then return false;
end;
$$;

revoke all on function private.production_payment_quote(bigint,boolean),private.production_payment_rupees(bigint),
  private.production_payment_priced_policy(jsonb,jsonb),private.production_payment_contract_valid(bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;

alter table private.production_payment_orders drop constraint production_payment_orders_amount_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_quote_check;
alter table private.production_payment_orders drop constraint production_payment_orders_captured_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_refunded_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_provider_refunded_paise_check;
alter table private.production_payment_orders drop constraint production_payment_funding_mode_check;
alter table private.production_payment_orders add constraint production_payment_amount_check check(amount_paise between 100 and 1000000);
alter table private.production_payment_orders add constraint production_payment_quote_check check(private.production_payment_contract_valid(amount_paise,quote,terms) is true);
alter table private.production_payment_orders add constraint production_payment_captured_check check(captured_paise in (0,amount_paise));
alter table private.production_payment_orders add constraint production_payment_refunded_check check(refunded_paise between 0 and amount_paise);
alter table private.production_payment_orders add constraint production_payment_provider_refunded_check check(provider_refunded_paise between 0 and amount_paise);
alter table private.production_payment_orders add constraint production_payment_funding_mode_check check((
  (terms->>'version' in ('operator-managed-v1','operator-managed-priced-v1') and terms->>'fundingMode'='operator_managed' and funding_evidence_id is null)
  or (terms->>'version' not in ('operator-managed-v1','operator-managed-priced-v1') and not(terms ? 'fundingMode') and funding_evidence_id is not null)
) is true);
alter table private.production_payment_orders drop column state;
alter table private.production_payment_orders add column state text generated always as (case
  when review_required then 'review_required'
  when refunded_paise=amount_paise then 'refunded'
  when refunded_paise>0 then 'partially_refunded'
  when refund_hold then 'refund_pending'
  when captured_paise=amount_paise then 'captured'
  when creation_uncertain then 'needs_reconciliation'
  when provider_order_id is not null then 'created'
  else 'creating' end) stored;
alter table private.production_payment_orders add column purpose text generated always as (
  case when quote->>'version'='inr-payment-verification-v1' then 'verification' else 'annual' end
) stored;
drop index private.production_payment_orders_active_business_idx;
create unique index production_payment_orders_active_business_idx on private.production_payment_orders(business_id)
  where purpose='annual' and (refunded_paise<amount_paise or review_required);
create unique index production_payment_verification_once_idx on private.production_payment_orders(business_id) where purpose='verification';

create or replace function private.production_payment_identity_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id,new.business_id,new.user_id,new.request_key,new.environment,new.account_id,new.key_id,new.amount_paise,new.currency,new.quote,new.terms,new.terms_hash,new.funding_evidence_id,new.accepted_at)
    is distinct from (old.id,old.business_id,old.user_id,old.request_key,old.environment,old.account_id,old.key_id,old.amount_paise,old.currency,old.quote,old.terms,old.terms_hash,old.funding_evidence_id,old.accepted_at) then
    raise exception 'Payment identity and accepted quote are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger production_payment_identity_guard before update on private.production_payment_orders
  for each row execute function private.production_payment_identity_guard();
revoke all on function private.production_payment_identity_guard() from public,anon,authenticated,service_role;

alter table private.production_payment_effects drop constraint production_payment_effects_check;
alter table private.production_payment_effects add constraint production_payment_effect_identity_check check(
  (kind='capture' and provider_id=payment_id) or (kind='refund' and provider_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'));
create or replace function private.production_payment_effect_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders;
begin
  select * into payment from private.production_payment_orders where id=new.order_id;
  if not found or new.account_id is distinct from payment.account_id or new.amount_paise>payment.amount_paise
    or (new.kind='capture' and new.amount_paise<>payment.amount_paise) then
    raise exception 'Payment effect must match the saved order amount' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger production_payment_effect_guard before insert or update on private.production_payment_effects
  for each row execute function private.production_payment_effect_guard();
revoke all on function private.production_payment_effect_guard() from public,anon,authenticated,service_role;

create or replace function public.production_payment_order_claim(
  p_business_id uuid,p_user_id uuid,p_request_key uuid,p_order_id uuid,
  p_account_id text,p_key_id text,p_quote jsonb,p_terms text,p_terms_hash text,p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders; policy jsonb; verification boolean; amount bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  perform 1 from public.businesses where id=p_business_id and owner_id=p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode='23514'; end if;
  if p_terms is null or octet_length(p_terms)>32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode='23514';
  end if;
  policy := p_terms::jsonb;
  amount := (p_quote->>'totalPaise')::bigint;
  verification := coalesce(p_quote->>'version'='inr-payment-verification-v1',false);
  if not private.production_payment_contract_valid(amount,p_quote,policy) then
    raise exception 'Invalid payment quote contract' using errcode='23514';
  end if;
  if policy->>'version'='operator-managed-priced-v1' then
    if p_funding_evidence_id is not null or (policy->>'approvedAt')::timestamptz>clock_timestamp()
      or (verification and not ((policy#>>'{verification,businessId}')::uuid=p_business_id
        and (policy#>>'{verification,userId}')::uuid=p_user_id
        and (policy#>>'{verification,expiresAt}')::timestamptz>clock_timestamp()
        and (policy#>>'{verification,expiresAt}')::timestamptz<=clock_timestamp()+interval '24 hours') is true) then
      raise exception 'Verification scope or pricing approval is unavailable' using errcode='23514';
    end if;
  elsif policy->>'version'='operator-managed-v1' then
    if p_funding_evidence_id is not null or policy is distinct from $policy${"version":"operator-managed-v1","fundingMode":"operator_managed","approvalReference":"https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300","approvedAt":"2026-09-26T17:58:20Z","serviceScope":"INR 10,000 total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. INR 2,000 is allocated to service and INR 8,000 to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.","invoiceTerms":"The invoice will reflect Vanshul Goyal's actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.","refundTerms":"Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The INR 2,000 service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable."}$policy$::jsonb
      or (policy->>'approvedAt')::timestamptz>clock_timestamp() then
      raise exception 'Operator-managed policy is not approved' using errcode='23514';
    end if;
  else
    if not ((jsonb_typeof(policy)='object'
      and policy-array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference']='{}'::jsonb
      and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
      and (policy->>'approvalReference')::uuid is not null and (policy->>'automaticFundingApprovalReference')::uuid is not null
      and length(trim(policy->>'serviceScope')) between 1 and 8000
      and length(trim(policy->>'invoiceTerms')) between 1 and 8000 and length(trim(policy->>'refundTerms')) between 1 and 8000
      and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz<=clock_timestamp()
      and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz>clock_timestamp()) is true)
      or not public.production_payment_funding_valid(p_business_id,p_funding_evidence_id) then
      raise exception 'Legacy policy or automatic funding evidence unavailable' using errcode='23514';
    end if;
  end if;
  select * into saved from private.production_payment_orders where business_id=p_business_id
    and (request_key=p_request_key or (purpose=case when verification then 'verification' else 'annual' end
      and (verification or refunded_paise<amount_paise or review_required)))
    order by (request_key=p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.terms is distinct from policy or saved.quote is distinct from p_quote
      or saved.funding_evidence_id is distinct from p_funding_evidence_id then
      raise exception 'Payment request scope changed' using errcode='23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,amount_paise,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,amount,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  return jsonb_build_object('claimed',true,'order',to_jsonb(saved));
end;
$$;

create or replace function public.production_payment_orders_list(p_business_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(payment)),'[]'::jsonb) from (
    select orders.* from private.production_payment_orders orders
    join public.businesses business on business.id=orders.business_id and business.owner_id=p_user_id
    where orders.business_id=p_business_id and orders.user_id=p_user_id
    order by (orders.purpose='verification') desc,orders.accepted_at desc limit 20
  ) payment;
$$;

create or replace function public.production_payment_observe(
  p_order_id uuid,p_account_id text,p_key_id text,p_payment_id text,p_capture_verified boolean,
  p_provider_refunded_paise bigint,p_review_required boolean,p_snapshot_hash text,
  p_refund_id text default null,p_refund_amount_paise bigint default null,p_refund_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders; existing private.production_payment_effects; refund_total bigint;
begin
  if not ((p_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and p_capture_verified is not null and p_review_required is not null
    and p_provider_refunded_paise between 0 and 1000000 and p_snapshot_hash ~ '^[a-f0-9]{64}$'
    and ((p_refund_id is null and p_refund_amount_paise is null and p_refund_status is null)
      or (p_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$' and p_refund_amount_paise between 1 and 1000000 and p_refund_status in ('pending','processed','failed')))) is true) then
    raise exception 'Invalid payment observation' using errcode='23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  select * into saved from private.production_payment_orders where id=p_order_id and account_id=p_account_id and key_id=p_key_id for update;
  if not found or saved.provider_order_id is null then raise exception 'Payment order not ready' using errcode='23514'; end if;
  if p_provider_refunded_paise>saved.amount_paise or p_refund_amount_paise>saved.amount_paise then
    update private.production_payment_orders set review_required=true,updated_at=clock_timestamp() where id=p_order_id returning * into saved;
    return to_jsonb(saved);
  end if;
  update private.production_payment_orders set
    review_required=review_required or p_review_required
      or (payment_id is not null and payment_id<>p_payment_id and (p_capture_verified or p_refund_id is not null or p_provider_refunded_paise>0))
      or exists(select 1 from private.production_payment_effects where order_id=p_order_id and payment_id<>p_payment_id)
      or exists(select 1 from private.production_payment_events where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id) and (conflicted or kind='dispute'))
      or exists(select 1 from private.production_payment_event_conflicts where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id)),
    refund_hold=refund_hold or p_refund_id is not null or p_provider_refunded_paise>0
      or exists(select 1 from private.production_payment_events where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id) and kind='refund'),
    provider_refunded_paise=greatest(provider_refunded_paise,p_provider_refunded_paise),updated_at=clock_timestamp()
    where id=p_order_id returning * into saved;
  if p_capture_verified then
    select * into existing from private.production_payment_effects where account_id=p_account_id and kind='capture' and provider_id=p_payment_id;
    if (found and (existing.order_id<>p_order_id or existing.amount_paise<>saved.amount_paise))
      or (saved.payment_id is not null and saved.payment_id<>p_payment_id) then
      update private.production_payment_orders set review_required=true where id in (p_order_id,existing.order_id);
    else
      insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
        values(p_account_id,'capture',p_payment_id,p_payment_id,p_order_id,saved.amount_paise,p_snapshot_hash) on conflict do nothing;
      update private.production_payment_orders set captured_paise=amount_paise,payment_id=p_payment_id where id=p_order_id;
    end if;
  end if;
  if p_refund_id is not null and (saved.payment_id is null or saved.payment_id=p_payment_id) then
    select * into existing from private.production_payment_effects where account_id=p_account_id and kind='refund' and provider_id=p_refund_id;
    if found and (existing.order_id<>p_order_id or existing.payment_id<>p_payment_id or existing.amount_paise<>p_refund_amount_paise or p_refund_status='failed') then
      update private.production_payment_orders set review_required=true where id in (p_order_id,existing.order_id);
    elsif p_refund_status='processed' then
      select coalesce(sum(amount_paise),0) into refund_total from private.production_payment_effects where order_id=p_order_id and kind='refund' and provider_id<>p_refund_id;
      if refund_total+p_refund_amount_paise>saved.amount_paise then
        update private.production_payment_orders set review_required=true where id=p_order_id;
      else
        insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
          values(p_account_id,'refund',p_refund_id,p_payment_id,p_order_id,p_refund_amount_paise,p_snapshot_hash) on conflict do nothing;
        update private.production_payment_orders set refunded_paise=refund_total+p_refund_amount_paise where id=p_order_id;
      end if;
    end if;
  end if;
  select * into saved from private.production_payment_orders where id=p_order_id;
  return to_jsonb(saved);
end;
$$;

create or replace function public.customer_ad_balance(p_business_id uuid,p_user_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  captured bigint; refunded bigint; service_allocation bigint; advertising bigint; ad_refunded bigint;
  media bigint; tax bigint; reserved bigint; held boolean; cost_held boolean;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    raise exception 'Customer owner not found' using errcode='42501';
  end if;
  select coalesce(sum(payment.captured_paise),0),coalesce(sum(payment.refunded_paise),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'serviceAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.refunded_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else coalesce(allocation.advertising_refunded_paise,0) end),0),
    coalesce(bool_or(payment.review_required or payment.provider_refunded_paise<>payment.refunded_paise
      or (payment.purpose<>'verification' and payment.refunded_paise>0 and payment.refunded_paise<payment.amount_paise
        and coalesce(allocation.service_refunded_paise+allocation.advertising_refunded_paise,-1)<>payment.refunded_paise)
      or (payment.refund_hold and payment.refunded_paise=0)
      or exists(select 1 from private.production_payment_refunds refund where refund.order_id=payment.id and refund.state in ('creating','submitted','needs_reconciliation'))
      or exists(select 1 from private.production_payment_events event where event.account_id=p_account_id
        and (event.payment_id=payment.payment_id or event.provider_order_id=payment.provider_order_id)
        and event.processed_at is null and event.kind in ('refund','dispute'))
      or (payment.captured_paise>0 and not exists(select 1 from private.production_payment_effects effect
        where effect.account_id=p_account_id and effect.order_id=payment.id and effect.kind='capture'
          and effect.payment_id=payment.payment_id and effect.amount_paise=payment.captured_paise))),false)
    into captured,refunded,service_allocation,advertising,ad_refunded,held
    from private.production_payment_orders payment
    left join private.customer_refund_allocations allocation on allocation.order_id=payment.id
    where payment.business_id=p_business_id and payment.user_id=p_user_id and payment.account_id=p_account_id and payment.environment='live';
  select coalesce(sum(cost.media_paise),0),coalesce(sum(cost.tax_paise),0),
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes')),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or ceil(reservation.daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000)
          >reservation.ceiling_paise-cost.media_paise-cost.tax_paise))
    or exists(select 1 from public.campaigns campaign where campaign.business_id=p_business_id and campaign.status='active'
      and not exists(select 1 from private.customer_ad_reservations reservation where reservation.campaign_id=campaign.id
        and reservation.account_id=p_account_id and reservation.state<>'closed'));
  return jsonb_build_object('businessId',p_business_id,'currency','INR','capturedPaise',captured,'refundedPaise',refunded,
    'serviceAllocationPaise',service_allocation,'advertisingAllocationPaise',advertising,'advertisingRefundedPaise',ad_refunded,
    'serviceEarnedPaise',coalesce((select sum(allocation.service_earned_paise) from private.customer_refund_allocations allocation
      join private.production_payment_orders payment on payment.id=allocation.order_id where payment.business_id=p_business_id and payment.account_id=p_account_id),0),
    'mediaCostPaise',media,'taxCostPaise',tax,'reservedPaise',reserved,
    'remainingPaise',case when held then 0 else greatest(advertising-ad_refunded-media-tax-reserved,0) end,
    'held',held,'reason',case when held then 'Payment, refund or cost reconciliation is required.' else null end,
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('campaignId',campaign_id,'reservationId',id,'state',state))
      from private.customer_ad_reservations where business_id=p_business_id and account_id=p_account_id),'[]'::jsonb));
end;
$$;

alter table private.customer_refund_allocations drop constraint customer_refund_allocations_service_earned_paise_check;
alter table private.customer_refund_allocations add constraint customer_refund_service_earned_check check(service_earned_paise between 0 and 200000);

create or replace function public.customer_ad_refund_allocation(p_business_id uuid,p_actor_id uuid,p_account_id text,p_order_id uuid,
  p_service_refunded_paise bigint,p_advertising_refunded_paise bigint,p_service_earned_paise bigint,p_evidence_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders; previous private.customer_refund_allocations;
  evidence jsonb; saved_evidence private.customer_refund_allocation_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  select * into payment from private.production_payment_orders where id=p_order_id and business_id=p_business_id and account_id=p_account_id and environment='live';
  if not found or not ((payment.captured_paise=payment.amount_paise and p_service_refunded_paise between 0 and (payment.quote->>'serviceAllocationPaise')::bigint
    and p_advertising_refunded_paise between 0 and (payment.quote->>'metaAllocationPaise')::bigint
    and p_service_refunded_paise+p_advertising_refunded_paise=case when payment.purpose='verification' then 0 else payment.refunded_paise end
    and p_service_earned_paise in (0,(payment.quote->>'serviceAllocationPaise')::bigint)
    and p_service_earned_paise+p_service_refunded_paise<=(payment.quote->>'serviceAllocationPaise')::bigint and p_evidence_reference is not null) is true) then
    raise exception 'Refund allocation must match verified payment and delivery evidence' using errcode='23514';
  end if;
  evidence:=jsonb_build_object('serviceRefunded',p_service_refunded_paise,'advertisingRefunded',p_advertising_refunded_paise,'serviceEarned',p_service_earned_paise);
  select * into saved_evidence from private.customer_refund_allocation_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.order_id<>p_order_id or saved_evidence.actor_id<>p_actor_id or saved_evidence.input<>evidence then
      raise exception 'Refund allocation evidence conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_refund_allocations where order_id=p_order_id;
  if found and (p_service_refunded_paise<previous.service_refunded_paise or p_advertising_refunded_paise<previous.advertising_refunded_paise
    or p_service_earned_paise<previous.service_earned_paise) then raise exception 'Financial allocations cannot be silently reduced' using errcode='23514'; end if;
  insert into private.customer_refund_allocation_evidence(reference,order_id,actor_id,input) values(p_evidence_reference,p_order_id,p_actor_id,evidence);
  insert into private.customer_refund_allocations(order_id,service_refunded_paise,advertising_refunded_paise,service_earned_paise,evidence_reference,actor_id)
    values(p_order_id,p_service_refunded_paise,p_advertising_refunded_paise,p_service_earned_paise,p_evidence_reference,p_actor_id)
    on conflict(order_id) do update set service_refunded_paise=excluded.service_refunded_paise,advertising_refunded_paise=excluded.advertising_refunded_paise,
      service_earned_paise=excluded.service_earned_paise,evidence_reference=excluded.evidence_reference,actor_id=excluded.actor_id;
end;
$$;

revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid),
  public.production_payment_orders_list(uuid,uuid),public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid),
  public.production_payment_orders_list(uuid,uuid),public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid) to service_role;