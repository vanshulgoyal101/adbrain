# Pilot Runbook

Part of the [incident playbooks](README.md#incident-playbooks). Spend guardrails and the operator-funded mark: [Spend Guardrails](../spend-guardrails.md#spend-guardrails).

### Pilot setup call (#1279; dry run on the demo business, Oct 28)

Run these in order on the call; each has a read-back. Nothing here spends or
activates anything.

1. **Operator grant is live** (the mark needs it):
   `select expires_at > now() from private.production_payment_operators where user_id='<owner id>' and revoked_at is null;`
   It must be `true`. If not, stop: renewing the grant is the owner's step (CEO asks).
2. **Mark the business operator-funded** with the command above (`true`, reason
   `Pilot <n>: owner funds directly on Meta (#…)`). Read back:
   `select public.operator_funded('<business id>');` gives `true`, and
   `private.operator_funding_audit` has the new row.
3. **Weekly cap, by the owner in Settings → Spend guardrails:** Weekly cap (₹),
   Warn at 80%, tick **Auto-pause at the cap**, **Save guardrails** → "Saved.".
   Read back: `select weekly_cap_rupees, alert_pct, auto_pause from spend_limits where business_id='<business id>';`.
4. **Meta spending limit (read-only):**
   `GET /act_<id>?fields=currency,spend_cap,amount_spent,is_prepay_account,account_status`.
   Room = `spend_cap − amount_spent` (paise). The first run's total must fit in the
   room; a `spend_cap` of 0 means no account limit, so the owner sets one in Meta
   Billing before launch.
5. **Undo** (pilot ends or a mistake): `operator_funding_set(…, false, '<reason>')`;
   clear the cap in Settings (empty cap, auto-pause off, Save).

Insight ingestion validates the aggregate response before saving it: missing
`data`, multiple rows, pagination, invalid numbers/dates, or duplicate selected
outcome actions fail refresh instead of replacing stored evidence with zeroes.
Explicit `data: []` is a valid no-delivery response. Lead extraction prefers exact
`lead`, then `onsite_conversion.lead_grouped` only when the aggregate is absent;
it never adds overlapping actions or matches arbitrary names containing `lead`.
This does not certify attribution equivalence with every Ads Manager report.

### Pilot day-7 pricing answers (#1650, for #718)

Seven days after a pilot's first Go live, Home asks own-account, non-team businesses "would you pay ₹999 a month?"
once ('Not now' hides it 3 days, at most twice). Answers are product events (codes only), kept 90 days, so copy the
tally to #718 before then (read-only):

```sql
select attributes->>'answer' as answer, attributes->>'reason' as reason, count(*) as owners,
  round(avg((attributes->>'days')::int)) as avg_days
from public.product_events where name = 'pilot_day7' group by 1, 2 order by 1, 3 desc;
```
