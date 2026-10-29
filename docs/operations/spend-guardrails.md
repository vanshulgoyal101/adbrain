# Spend Guardrail Operations

Part of [Operations](README.md).

## Spend Guardrails

[The evaluator](../../src/lib/campaign/spend.ts) uses these quantities:

```text
projectedWeekly = sum(active campaign daily budgets) * 7
trackedSpend = sum(latest stored spend snapshot per campaign)
used = max(projectedWeekly, trackedSpend)
```

Tracked spend is **not intrinsically a current-calendar-week aggregate**. It has
the time range of the fetched insight snapshot. Historical/stale snapshots and
missing campaign imports limit accuracy. Do not sum all snapshots together;
they are repeated observations, not ledger deltas.

Example: active campaigns with daily budgets INR 300 and INR 200 project INR 3500.
If latest tracked spend totals INR 4200 against a INR 5000 cap, displayed usage
is 84%. Adding an INR 250/day campaign projects INR 5250 and blocks activation.
Auto-pause requires tracked spend >= cap and `autoPause=true`; a high projection
alone does not trigger it. A/B total budgets include all ad sets.

`weeklyCap=null` disables the cap; zero is invalid in the settings API. Alert
percentage is 1-100. Activation checks are not atomic financial reservations:
concurrent activations and changes made directly in Meta can exceed expectations.
Use Meta/provider spending controls as the stronger external boundary.

Activation fails closed when a saved cap is invalid, the requested budget is
invalid, or an active campaign's budget is missing/invalid while a cap is enabled.
Sync campaigns and repair spend settings before retrying. A deliberately null cap
remains unlimited; paused campaigns' unknown budgets do not affect the projection.
Pause operations do not depend on spend reads succeeding. Dashboard estimates
still use known values; they are not proof that activation evidence is complete.

Operator-funded businesses (#245): DevOps marks or clears one with the owner's
live payment-operator grant, giving a reason, in the production SQL editor:
`select public.operator_funding_set('<business id>','<operator user id>',true,'<reason>');`
(`false` clears it). The audit table records who, when and why. Such a business
runs only capped runs inside its Meta ad account spending limit; the sweep keeps
the weekly cap but skips the customer allowance hold. A capped run created outside
AdBrain (the #157 run) is adopted after the mark with
[`scripts/adopt-capped-run.ts`](../../scripts/adopt-capped-run.ts): it reads the Meta
tree back exactly, prints the campaign row (dry run), and `--apply` saves it through
`saveCampaign` so Pause, sync and results manage the run.
