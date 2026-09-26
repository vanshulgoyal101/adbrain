alter table private.production_payment_orders alter column funding_evidence_id drop not null;
alter table private.production_payment_orders drop constraint if exists production_payment_funding_mode_check;
alter table private.production_payment_orders add constraint production_payment_funding_mode_check check (((
  terms->>'version' = 'operator-managed-v1' and terms->>'fundingMode' = 'operator_managed' and funding_evidence_id is null
) or (
  terms->>'version' <> 'operator-managed-v1' and not (terms ? 'fundingMode') and funding_evidence_id is not null
)) is true);

create or replace function public.production_payment_order_claim(
  p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid,
  p_account_id text, p_key_id text, p_quote jsonb, p_terms text, p_terms_hash text, p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  policy jsonb;
  operator_managed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  perform 1 from public.businesses where id = p_business_id and owner_id = p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode = '23514'; end if;
  if p_terms is null or octet_length(p_terms) > 32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode = '23514';
  end if;
  policy := p_terms::jsonb;
  operator_managed := coalesce(policy->>'version' = 'operator-managed-v1',false);
  if operator_managed then
    if p_funding_evidence_id is not null or policy is distinct from $policy${"version":"operator-managed-v1","fundingMode":"operator_managed","approvalReference":"https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300","approvedAt":"2026-09-26T17:58:20Z","serviceScope":"INR 10,000 total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. INR 2,000 is allocated to service and INR 8,000 to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.","invoiceTerms":"The invoice will reflect Vanshul Goyal's actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.","refundTerms":"Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The INR 2,000 service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable."}$policy$::jsonb
      or (policy->>'approvedAt')::timestamptz > clock_timestamp() then
      raise exception 'Operator-managed policy is not approved' using errcode = '23514';
    end if;
  else
    if not ((jsonb_typeof(policy) = 'object'
      and policy - array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference'] = '{}'::jsonb
      and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
      and (policy->>'approvalReference')::uuid is not null
      and (policy->>'automaticFundingApprovalReference')::uuid is not null
      and length(trim(policy->>'serviceScope')) between 1 and 8000
      and length(trim(policy->>'invoiceTerms')) between 1 and 8000
      and length(trim(policy->>'refundTerms')) between 1 and 8000
      and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz <= clock_timestamp()
      and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz > clock_timestamp()) is true)
      or not public.production_payment_funding_valid(p_business_id,p_funding_evidence_id) then
      raise exception 'Legacy policy or automatic funding evidence unavailable' using errcode = '23514';
    end if;
  end if;
  select * into saved from private.production_payment_orders where business_id = p_business_id
    and (request_key = p_request_key or refunded_paise < amount_paise or review_required)
    order by (request_key = p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.terms is distinct from policy or saved.quote is distinct from p_quote
      or saved.funding_evidence_id is distinct from p_funding_evidence_id then
      raise exception 'Payment request scope changed' using errcode = '23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  return jsonb_build_object('claimed',true,'order',to_jsonb(saved));
end;
$$;
revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) to service_role;