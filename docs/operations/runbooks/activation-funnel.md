# Activation Funnel Runbook

Part of the [incident playbooks](README.md#incident-playbooks).

### Activation Funnel

`node scripts/funnel.mjs [--days 14] [--include-internal]` (#338) shows where each sign-up of the last N
days (1–365) stopped. It prints one row per user and a total per step:
signed up → Brand saved → first ad generated → ad approved → Campaigns opened →
asked to connect Meta → Meta connected → top-up paid → campaign created → first
lead/chat. Each row has the user-id prefix, sign-up time, last step reached, last
seen (UTC) and a ✓/· mark per step. The query is read-only, through the same API as `prod-sql.mjs`. It
never prints emails or names, and leaves out internal accounts unless you pass
`--include-internal`. Steps come from durable tables (businesses,
creatives, Meta connections, live captured payments, campaigns with a Meta id,
leads and WhatsApp conversations). Campaigns opened, asked to connect Meta
(`/api/meta/oauth/start`, a `meta.connect*` `ui.action`, or `meta.access_request` from
**Ask for Facebook access** before Meta App Review) and last seen come from
`product_events`, which are pruned over time. A later step can be reached
without an earlier one, for example an operator-funded business never tops up.
The CEO and CTO rerun it weekly.

**Customer-only numbers (#379).** Every reported number excludes internal accounts by
default. They are defined once in
[internal-accounts.json](../../../src/lib/internal-accounts.json), which the app also uses to lift
the monthly AI limit for them (#398) and to give them free images (Cloudflare, then Pollinations, #1476) instead of the
paid image model (#449, #466; text stays on Haiku; `exemptFromFreeProviders` lists the user ids
that keep the paid images, each with its reason): team domains
(`@adbrain.vanshul.com`, `@adbrain.local`), owner user ids, and the smoke/demo emails
from the owner's local `.env.smoke`. **To mark a new internal account,** add its domain
or its auth user id to that file in a PR; never an email, because the repo is public.
`node scripts/product-events.mjs [--days 7]` counts customer events per name, and
`node scripts/product-events.mjs "select ... from events"` runs any one read-only query
over `events`. That is `product_events` of real customers only: by user, or by
business owner for background events; system rows are left out. Add
`--include-internal` to either command to see everyone.
**Smoke/demo Meta writes (#1324).** A business owned by a `smokeUserIds` login may only read,
validate (`validate_only`) and pause on Meta; MetaClient refuses anything else (403) before it is
sent, unless the connected ad account is listed in `testAdAccountIds`. Add the test ad account
there when DevOps creates it.
