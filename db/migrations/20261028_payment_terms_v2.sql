-- #1235 (CEO, Oct 28): customer terms never show AdBrain's share. New checkouts use 'operator-managed-priced-v2',
-- whose service scope and refund terms speak of "your ad budget" with no split; the verification texts are unchanged.
-- v1 (fixed and priced) stays valid, so existing orders keep their exact terms. The bodies below are the live
-- definitions (from 20261023_custom_payment_amount.sql / 20260927_configurable_payment_quotes.sql) with v2 accepted.
-- Internal accounting (quote, allocations, reservations) is unchanged.
begin;
set local lock_timeout = '5s';

create or replace function private.production_payment_priced_policy_v2(p_quote jsonb,p_verification jsonb default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare service_scope text; refund_terms text;
begin
  if p_verification is not null then
    service_scope := 'One real '||private.production_payment_rupees((p_quote->>'totalPaise')::bigint)
      ||' payment to verify checkout for the selected internal pilot. This is not the annual service and grants no service or advertising allocation, renewal or ad activation. AdBrain absorbs gateway fees; no additional checkout charge applies.';
    refund_terms := 'This verification payment remains recorded separately from service and advertising funds. Refund requests are handled by the operator under applicable law; no automatic refund is initiated. Mandatory customer rights remain applicable.';
  else
    service_scope := '₹'||substr(private.production_payment_rupees((p_quote->>'totalPaise')::bigint),5)
      ||' for 12 months for one business, one offer and one service area, including up to two ads and one capped Meta campaign. It includes your ad budget, with Meta''s GST. Gateway fees are on us. No extra charge, automatic renewal, year-round delivery or guaranteed results. The operator pays Meta separately.';
    refund_terms := 'Full refund before we start work. After that, your unused ad budget is refundable once pending Meta costs are settled. Mandatory customer rights remain applicable.';
  end if;
  return jsonb_build_object('version','operator-managed-priced-v2','fundingMode','operator_managed',
    'approvalReference','https://github.com/vanshulgoyal101/adbrain/issues/1235#issuecomment-6467091869',
    'approvedAt','2026-10-28T10:52:31Z','serviceScope',service_scope,
    'invoiceTerms','The invoice will reflect Vanshul Goyal''s actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.',
    'refundTerms',refund_terms,'quote',p_quote)
    || case when p_verification is not null then jsonb_build_object('verification',p_verification) else '{}'::jsonb end;
end;
$$;
revoke all on function private.production_payment_priced_policy_v2(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function private.production_payment_contract_valid(p_amount bigint, p_quote jsonb, p_terms jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare verification boolean;
begin
  verification := coalesce(p_quote->>'version'='inr-payment-verification-v1',false);
  if p_quote is distinct from private.production_payment_quote(p_amount,verification)
    or p_amount is null or jsonb_typeof(p_quote)<>'object' then return false; end if;
  if p_terms->>'version' in ('operator-managed-priced-v1','operator-managed-priced-v2') then
    if verification then
      if not ((jsonb_typeof(p_terms->'verification')='object'
        and (p_terms->'verification')-array['businessId','userId','expiresAt']='{}'::jsonb
        and (p_terms#>>'{verification,businessId}')::uuid is not null
        and (p_terms#>>'{verification,userId}')::uuid is not null
        and isfinite((p_terms#>>'{verification,expiresAt}')::timestamptz)) is true) then return false; end if;
    elsif p_terms ? 'verification' then return false;
    end if;
    return p_terms=case when p_terms->>'version'='operator-managed-priced-v2'
      then private.production_payment_priced_policy_v2(p_quote,case when verification then p_terms->'verification' else null end)
      else private.production_payment_priced_policy(p_quote,case when verification then p_terms->'verification' else null end) end;
  end if;
  return not verification and p_quote=private.production_payment_quote(1000000,false);
exception when others then return false;
end;
$function$

;

create or replace function public.production_payment_order_claim(p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid, p_account_id text, p_key_id text, p_quote jsonb, p_terms text, p_terms_hash text, p_funding_evidence_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved private.production_payment_orders; open_order private.production_payment_orders; policy jsonb; verification boolean; amount bigint;
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
  if policy->>'version' in ('operator-managed-priced-v1','operator-managed-priced-v2') then
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
  if not verification and amount not between 50000 and 1000000 then
    raise exception 'Payment amount must be from INR 500 to INR 10,000' using errcode='23514';
  end if;
  select * into saved from private.production_payment_orders where business_id=p_business_id
    and (request_key=p_request_key or (verification and purpose='verification'))
    order by (request_key=p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.terms is distinct from policy or saved.quote is distinct from p_quote
      or saved.funding_evidence_id is distinct from p_funding_evidence_id then
      raise exception 'Payment request scope changed' using errcode='23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  if not verification then
    select * into open_order from private.production_payment_orders where business_id=p_business_id
      and purpose='annual' and captured_paise=0 and superseded_at is null for update;
    if found then
      if open_order.user_id is not distinct from p_user_id and open_order.account_id is not distinct from p_account_id
        and open_order.key_id is not distinct from p_key_id and open_order.terms_hash is not distinct from p_terms_hash
        and open_order.terms is not distinct from policy and open_order.quote is not distinct from p_quote
        and open_order.funding_evidence_id is not distinct from p_funding_evidence_id then
        return jsonb_build_object('claimed',false,'order',to_jsonb(open_order));
      end if;
      if open_order.provider_order_id is null or open_order.creation_uncertain or open_order.review_required
        or open_order.refund_hold or open_order.payment_id is not null
        or exists(select 1 from private.production_payment_events event where event.account_id=open_order.account_id
          and event.provider_order_id=open_order.provider_order_id and event.processed_at is null) then
        raise exception 'An earlier payment request must be reconciled before a new amount' using errcode='23514';
      end if;
      update private.production_payment_orders set superseded_at=clock_timestamp(),updated_at=clock_timestamp() where id=open_order.id;
    end if;
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,amount_paise,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,amount,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  return jsonb_build_object('claimed',true,'order',to_jsonb(saved));
end;
$function$

;
revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) to service_role;

alter table private.production_payment_orders drop constraint production_payment_funding_mode_check;
alter table private.production_payment_orders add constraint production_payment_funding_mode_check check (
  ((terms->>'version' in ('operator-managed-v1','operator-managed-priced-v1','operator-managed-priced-v2') and terms->>'fundingMode'='operator_managed' and funding_evidence_id is null)
  or (terms->>'version' not in ('operator-managed-v1','operator-managed-priced-v1','operator-managed-priced-v2') and not(terms ? 'fundingMode') and funding_evidence_id is not null)) is true);

commit;
