alter table public.campaigns
  add constraint campaigns_budget_finite_nonnegative
    check (daily_budget is null or (daily_budget >= 0 and daily_budget < 'Infinity'::numeric)) not valid;

alter table public.campaign_results
  add constraint campaign_results_metrics_safe
    check (impressions between 0 and 9007199254740991
      and clicks between 0 and 9007199254740991
      and leads between 0 and 9007199254740991
      and (conversations is null or conversations between 0 and 9007199254740991)) not valid,
  add constraint campaign_results_costs_finite_nonnegative
    check (spend >= 0 and spend < 'Infinity'::numeric
      and (cpl is null or (cpl >= 0 and cpl < 'Infinity'::numeric))
      and (cost_per_conversation is null or (cost_per_conversation >= 0 and cost_per_conversation < 'Infinity'::numeric))) not valid,
  add constraint campaign_results_period_order
    check ((period_start is null and period_end is null)
      or (period_start is not null and period_end is not null
        and isfinite(period_start) and isfinite(period_end) and period_start <= period_end)) not valid,
  add constraint campaign_results_fetched_finite check (isfinite(fetched_at)) not valid;

alter table public.spend_limits
  add constraint spend_limits_positive_cap check (weekly_cap_rupees is null or weekly_cap_rupees > 0) not valid;

alter table public.campaigns add constraint campaigns_business_id_id_key unique (business_id, id);
alter table public.leads
  add constraint leads_same_business_campaign foreign key (business_id, campaign_id)
    references public.campaigns(business_id, id) on delete set null (campaign_id) not valid;
alter table public.campaign_operations
  add constraint operations_same_business_campaign foreign key (business_id, campaign_id)
    references public.campaigns(business_id, id) on delete set null (campaign_id) not valid,
  add constraint operations_same_business_draft foreign key (business_id, draft_id)
    references public.campaign_drafts(business_id, id) on delete restrict not valid;