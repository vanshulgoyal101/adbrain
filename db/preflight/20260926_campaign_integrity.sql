begin read only;
select 'campaign_budget' as violation, count(*) as rows from public.campaigns
where daily_budget < 0 or daily_budget >= 'Infinity'::numeric
union all
select 'result_metrics', count(*) from public.campaign_results
where impressions not between 0 and 9007199254740991 or clicks not between 0 and 9007199254740991
  or leads not between 0 and 9007199254740991 or conversations not between 0 and 9007199254740991
union all
select 'result_costs', count(*) from public.campaign_results
where spend < 0 or spend >= 'Infinity'::numeric or cpl < 0 or cpl >= 'Infinity'::numeric
  or cost_per_conversation < 0 or cost_per_conversation >= 'Infinity'::numeric
union all
select 'result_dates', count(*) from public.campaign_results
where (period_start is null) <> (period_end is null) or period_start > period_end
  or not isfinite(period_start) or not isfinite(period_end) or not isfinite(fetched_at)
union all
select 'weekly_cap', count(*) from public.spend_limits where weekly_cap_rupees <= 0
union all
select 'lead_campaign', count(*) from public.leads lead
left join public.campaigns campaign on campaign.id = lead.campaign_id and campaign.business_id = lead.business_id
where lead.campaign_id is not null and campaign.id is null
union all
select 'operation_campaign', count(*) from public.campaign_operations operation
left join public.campaigns campaign on campaign.id = operation.campaign_id and campaign.business_id = operation.business_id
where operation.campaign_id is not null and campaign.id is null
union all
select 'operation_draft', count(*) from public.campaign_operations operation
left join public.campaign_drafts draft on draft.id = operation.draft_id and draft.business_id = operation.business_id
where draft.id is null
union all
select 'draft_owner', count(*) from public.campaign_drafts draft
join public.businesses business on business.id = draft.business_id
where draft.owner_id <> business.owner_id;
rollback;