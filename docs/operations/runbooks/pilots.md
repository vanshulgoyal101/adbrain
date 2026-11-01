# Pilot Runbook

Part of the [incident playbooks](README.md#incident-playbooks). Spend guardrails and the operator-funded mark: [Spend Guardrails](../spend-guardrails.md#spend-guardrails).

### Visit: sign in, prepare, connect and launch

Use [Your first ad on a phone](../../product/first-ad.md) for the owner's screens
and [Prospect Account Hand-over](prospect-handover.md) for a prepared sample account.
Keep customer details in the private store, never in this runbook or public issues.

1. **Sign in on the owner's phone, Google first (#2416):** tap **Continue with
   Google**, using the same email supplied for a hand-over. Google's screen names
   `…supabase.co`, AdBrain's sign-in service. Use **Email me a sign-in link** only
   without a Google account: the documented limit is **2 sign-in emails an hour,
   project-wide** (#1777), shared with staff sign-ins and resends. Space email
   sign-ins 30 minutes apart and send no staff links that hour. If the screen says
   "Too many sign-in emails", use Google or wait an hour; repeated resends do not
   bypass the cap. A Google redirect is not proof that a non-team account can
   sign in: #2416 still needs that result; the CEO batches the owner's Google
   publishing-status or non-team sign-in step. Do not promise email delivery
   from the default mailer while custom SMTP remains open on #1777.
2. **Prepare or take ownership:** fill Brand, then make and pick the ads. With a
   prepared prospect, tap **Make it mine** within the 30-minute hand-over window;
   if it expires, have the rep start the hand-over again. Hand-over is shipped,
   not a pending blocker, and does not connect Meta or launch anything.
   Create reliability remains open on #2444: partial batches may save fewer than
   3 ads. Keep the saved ads; **Make another** can replace a missing one. If the
   batch is still running, use **Check again**, not another batch. No paid
   provider runs or repeated test generations are authorized by this workaround.
3. **Get Meta ready before Connect (#1928, #2366):** while App Review (#156) is
   pending, the owner must be invited as an adBrain **Tester** and accept at
   developers.facebook.com/requests. The CEO batches the profile-link/invite and
   missing pilot settings with the owner; a failed connection is not fixed by
   repeated taps. Use the owner's own business portfolio, with their Page and an
   active ad account in **INR** together in it, the intended WhatsApp number and
   a payment method. For a new account choose **Asia/Kolkata**; Meta cannot change
   its currency or time zone later. If the Page/account pair is ineligible, fix
   it in Meta Business Settings, then reconnect; do not use another portfolio
   or a non-rupee account as a workaround.
4. **Review, then Go live only with the owner's approval:** fix each named
   rejection first. Launch refuses a WhatsApp opening that differs from what
   Review checked (#2452); after changing it, review again rather than bypassing
   the check. The existing budget, consent and funding requirements still apply.
   #1146/#1147 are shipped fixes, not prerequisites to wait for.
5. **Manage after a real launch:** sync, check delivery/results and use Pause
   when needed. An internal phone/preflight check is not an outside activation
   or fresh Results/Manage pass. Follow #1221's current go/no-go: #2366's accepted
   Tester-to-Review check and #2416's non-team login remain unproven; #2396's
   smoke-identity blocker is separate from #2444's partial batches, and #1324's
   test-ad-account blocker is not proof that an owner's account cannot work.

**Role OFF is not an operations pause (#884):** it stops headless role runs, not
scheduled-job dispatch, daily quota checks, nightly backups or smoke-storage
pruning. See [Scheduled Jobs](../scheduled-jobs.md) and [Backups](../backups.md).
Resuming roles grants no new ad spend, paid calls, Meta writes or settings changes.

### Pilot setup call (#1279; dry run on the demo business, Oct 28)

Run these in order on the call; each has a read-back. Nothing here spends or
activates anything.

1. **Operator grant is live** (the mark needs it):
   `select expires_at > now() from private.production_payment_operators where user_id='<owner id>' and revoked_at is null;`
   It must be `true`. If not, stop: renewing the grant is the owner's step (CEO asks).
2. **Mark the business operator-funded** with the linked [Spend Guardrails command](../spend-guardrails.md#spend-guardrails) (`true`, reason
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
