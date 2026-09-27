# Issue #49: Spend Observation Follow-Up

Source-only Dev candidate based on production source
`a8ec89d516d90c1fc8716497ac087cf0a228d7e1`. QA acceptance, required
integration CI, provider evidence, and deployment are separate.

Refresh and the scheduled sweep now read bound Meta insights for the selected
account's Monday-to-today reporting period. Both require complete INR observations
for every campaign before trusting the weekly total; unknown observations trigger
protective pauses. The sweep pages through opted-in limits and campaigns and
preserves customer balance holds and reservation confirmations. Refresh keeps
`autoPaused` and adds `protectionConfirmed`; the UI warns when protection is
unconfirmed. Scheduled enforcement returns 503 on partial/uncertain sweeps.

Local author checks: six focused Vitest suites (182 passing), TypeScript
`--noEmit`, touched-file ESLint, editor diagnostics, and `git diff --check`.
All tests use synthetic data. No provider call, customer mutation, database
migration, hosted CI or production verification was performed.

QA should review missing/old/partial reporting, currency/period mismatch,
pagination, provider failure, remote/local pause uncertainty and financial holds.
The job remains daily with a 60-second execution limit; this guardrail does not
certify real-time or provider-side spending ceilings, customer cost/tax evidence,
or live Meta reporting compatibility. The release owner must verify those
separately before making customer-spend guarantees.