# Roadmap

Priorities describe future work and unresolved evidence, not shipped commitments
or estimated delivery dates. [Features](FEATURES.md) is the current capability
inventory; [QA](qa/) and [releases](releases/) record dated verification. Review
this backlog against the checked-out source and current remote state before starting.

## Release and Customer Gates

| Priority | Gap | Acceptance evidence |
| --- | --- | --- |
| First | Dependency-complete promotion and migration coordination | Exact reviewed SHA, passing gates, authorized schema/env changes, deployed workflow receipt |
| First | Real intended-customer Meta consent | Successful owner-controlled consent/selection/capabilities, current provider approvals; mocks insufficient |
| First | Repeatable creative quality and cost | Consented representative fixtures, bounded paid evaluations, actual provider usage and human review |
| First | Honest performance proof | Permissioned campaign baseline, comparable measurement window and attributable outcomes |
| First | Operational readiness | Monitored jobs, alert ownership, recovery and deletion drills, support escalation |

## Reliability and Workflow

| Work | Why / dependency |
| --- | --- |
| Durable generation jobs and server idempotency | Avoid duplicate paid work and recover across request/process termination; tab recovery alone is insufficient |
| Atomic quota reservation and stronger budget controls | Current token check and best-effort ledger can race/undercount; image costs need separate treatment |
| Campaign reconciliation tooling | Make uncertain external operations inspectable and safely repairable without blind manual edits |
| Scheduled insight/lead synchronization | Daily spend enforcement exists but reads stored snapshots; it is not fresh provider sync |
| Snapshot persistence hardening | Refresh currently can return a null stored result despite fetched metrics |
| Media retention and privacy operations | Public URLs, row/object non-atomicity and orphan cleanup need explicit policy/tooling |
| Operational alerts and incident views | Structured privacy-aware events exist; alert delivery and a cross-account support UI do not |
| Guided onboarding completion | Validate first-run brand -> creative -> paused campaign across real customer states |
| Visual/accessibility regression depth | Extend populated/empty/error, keyboard and mobile evidence; do not reclassify already delivered UI as wholly absent |

## Commercial and Growth

| Work | Gate |
| --- | --- |
| Pricing, billing and entitlements | Demonstrated repeatable value, measured costs, payment/webhook/refund/cancellation/support design |
| Lead notifications and follow-up | Reliable sync/webhooks, consent, channel configuration, retry/delivery tracking |
| Lead-to-deal and revenue attribution | Explicit lifecycle/data model and trustworthy outcome evidence |
| Trend and per-creative analysis | Defined insight windows, historical data quality and attribution |
| Teams and agency workspaces | Membership roles, shared ownership/RLS, audit and business selection design |
| Scheduled activation / optimization | Durable execution, financial consent and strong stop/recovery controls |
| Google Ads, video and other channels | Customer demand, access approval, evaluated providers and separate contracts |
| Branded auth domain | Verified provider configuration, DNS/plan costs and migration strategy; do not bypass Auth casually |

## Already Implemented, Still Bounded

Industry-neutral profiles, paid OpenRouter images, explicit image fallback,
creative interview/recovery, versioned drafts, durable campaign operations,
encrypted business-bound Meta access, local spend controls, daily spend cron,
structured logging and server-only usage/rate-limit persistence are implemented
in source. This does not establish that every migration is deployed or every
customer/provider path has been verified. Consult the dedicated references.

## Sequencing

Resolve customer-access and release gates, make core workflows recoverable and
observable, measure real value and costs, then introduce commercial automation.
Run legitimate Meta review work in parallel without synthetic traffic promises.
Extend channels and autonomous optimization only after the current loop is
understandable, supportable and safe to operate.
