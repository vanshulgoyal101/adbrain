# Settings: Spend Guardrails and Preferences

Part of [Features and workflows](README.md).

## Own-account Plan

When `PLAN_BILLING_ENABLED` is enabled, Settings shows the own-account ₹999
monthly plan and its payment link when payable. It checks payable open links for
lost paid webhooks using the original captured-payment timestamp. A failed
check shows a plan-unavailable alert instead of hiding the card or claiming
the plan is free. Managed and operator billing are unchanged.

## Stopping and Disconnecting

Own-account billing explains in English and Hindi that stopping payment leaves
running Meta ads, results and enquiries intact; new ads and campaigns wait for
payment. Disconnecting Facebook does not pause ads and prevents AdBrain from
pausing them or updating their results. The disconnect confirmation repeats that
warning and offers **Keep connected**. Data deletion uses **Privacy and data
requests**; campaigns remain in the owner's Meta account. Managed, operator and
unknown funding modes do not show the own-account billing promises.

## Spend Guardrails

Settings accept a positive whole-rupee weekly cap or explicit `null` for no cap,
an alert percentage from 1-100, and an auto-pause flag. Zero is invalid, not
unlimited. Unsaved changes invalidate the Saved indicator.

Activation compares projected weekly commitment against the cap; unavailable
spend data blocks activation. The same projection (`weeklyCapNotice`, #1342)
shows the cap on the campaign Review and the activation review, and an over-cap
daily budget is refused at the budget field, before Check my campaign or Send to
Meta, not first at Activate. Refresh and the daily scheduled sweep request bound
Meta insights for Monday through today in the selected account's timezone.
They require a complete INR observation for every campaign before comparing the
weekly total to the rupee cap. Missing, partial, mismatched-period/currency or
failed observations trigger protective pauses of active campaigns; an unknown
observation or failed pause remains unconfirmed even when some pauses succeed.
Existing reporting snapshots are not audited customer cost or tax evidence.
These are application guardrails, not Meta account spending limits or guaranteed
protection from overspend between checks or during outages. Use provider-side limits.

## Declared Preferences

After the additive [declared-preferences migration](../../db/migrations/20260930_declared_preferences.sql)
is applied, Settings offers an optional per-owner, per-business preference list.
Enable it to remember one short note per category, then edit, forget, pause or
clear the notes. The same Settings area shows notes while paused and can export
the saved notes as JSON. Pausing excludes them from future interviews/planning;
it does not erase them. Re-enabling does not reread old conversations or campaigns.

Creative interviews, campaign planning and active ad generation/regeneration receive
at most five relevant advisory notes (up to 1000 characters of serialized notes)
alongside the current request. Generation gives these notes to concept and image
providers only after an accepted request; a replay does not launch another provider
call or reread notes.
"Ignore preferences" and "fresh direction" omit them for that request. Notes
cannot authorize spend, justify a commercial claim, override an explicit current
brief, or turn an old tagline into required copy. Explicit Brand and legal
requirements remain separate. A model-written Create brief is direction only,
not proof of commercial claims: its original typed goal and free-text answers
are separately supplied as evidence, while suggested options and saved memories
are excluded. A directly typed Studio brief can supply evidence. Changing explicit
facts under the same generation ID is rejected; the accepted facts are retained
for regeneration. This is source behavior after the migration is
applied, not a claim of deployment or provider quality. When preferences are
applied, saved image-prompt receipts contain only an omission marker. The saved
concept and creative may still reflect their style, and forgetting cannot retract
provider calls or erase older creative output influenced by a note. The first
slice has no inferred notes, background extraction, cross-business profile or
historical backfill. A memory
read outage omits advisory context; failed explicit writes surface an error.
