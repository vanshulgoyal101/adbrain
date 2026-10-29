
# Features and Workflows

Current source behavior, reviewed 2026-09-18. This guide replaces the older mixed
inventory of shipped features and proposals. Deployment evidence lives in
the PRs and issues; priorities belong in [Roadmap](../roadmap.md). Start at [the documentation index](../README.md).

## Pages

| Page | What the owner does there |
| --- | --- |
| [Sign in and connect Meta](setup.md) | Sign in; connect a Meta ad account and Page |
| [Brand](brand.md) | Build the Brand Brain the ads are written from |
| [Create and review ads](create.md) | Make ads, edit them, approve them |
| [Prepare a campaign](launch.md) | Start a campaign draft, WhatsApp campaigns |
| [Targeting and budget](targeting-and-budget.md) | Who sees the ads and what it costs |
| [Review, create, activate](review.md) | Pre-launch review, paused creation, go live |
| [Manage: sync, results and leads](manage.md) | Results, enquiries, pause and edit |
| [Settings](settings.md) | Spend guardrails and declared preferences |

## Source and Availability

This guide describes source behavior. Source alone does not prove that a target
database has the required migrations or that a deployment has the required
configuration; check [Data Model](../DATA_MODEL.md#migration-map) and
[Configuration](../CONFIGURATION.md) before demonstrating a workflow there.

| Workflow | Availability boundary |
| --- | --- |
| Resumable lead sync, enquiry follow-up and server inbox paging | Lead sync-progress and follow-up migrations |
| WhatsApp conversation results | WhatsApp reporting migration |
| Declared preferences, customer allowance | Their additive migrations |
| Worker campaign creation | `CAMPAIGN_EXECUTION_MODE=worker`, worker migration and a running worker; default is inline |
| Live checkout | Live payment flags on a production `main` deployment; see [API Reference](../api/payments.md#configurable-live-payments) |
| Test checkout | Local only: `PAYMENTS_TEST_ENABLED=true`, loopback Supabase, no Vercel environment; see [test payments](../api/payments.md#local-test-payments) |
| Scheduled jobs | `vercel.json` schedules only the keepalive and the daily spend-enforcement sweep |

No checkout path, test or live, makes money spendable or activates ads. Mocked
consent, a green build or merchant approval do not prove live delivery, payment
settlement or provider eligibility.

## Product Model

A user owns a business. Most workspace pages select that user's oldest business
as the primary business. The schema supports multiple business rows, but the UI
is not an agency workspace, team-role system, or general business switcher.
An application's business ID, Meta business ID, ad account ID, and Facebook Page
ID are different identifiers. Never infer one from another.

| Page | Job | Important boundary |
| --- | --- | --- |
| `/dashboard` | The newest enquiry from the last 24 h still waiting for a first reply ("Rohit tapped your ad at 9:40 am. Reply now; …", #1292); for the newest live campaign, "Meta is checking your ads; they usually start within a day." while every ad is in review and nothing has delivered (stored per-ad statuses, no Meta call), or the rejected-ads sentence and fixes when Meta disapproved an ad (one Meta review read, #1469); then results so far (enquiries, spent, per enquiry, oldest update; same latest results as the campaign cards, #764; the median time to the first WhatsApp/Call tap over 30 days, "You usually contact people within …", #1049/#1443), next action, onboarding progress, activity | Uses stored state (plus that one review read); not proof of live provider health |
| `/brand` | Setup step 1 for first-timers; profile, assets, Markdown instructions (`?all=1`) | Saved business facts ground AI output |
| `/create` | Guided creative interview and brief review | Reviewing a brief is distinct from paid generation; the Brand context panel names missing offers, service areas and phone before a run. Any goal, typed or from a suggestion, on a Brand with an offer or proof point, an area and a phone skips the review when the interview needs no question. The start screen says what the ads will use ('Your 3 ads will use: Mohali · offer: Free site survey'; every Brand area Create sends, the first 3 then '+N more' (#1034); a proof point is labelled 'proof:', facts cut at 40 characters) above 'Make 3 ads', with 'About 2 minutes. Nothing is published.' under it and 'Edit brief' to keep the review; afterwards the brief shows as a collapsed 'What I'll write about · Edit' line (#858, #1004). After 'Use this ad', the one primary step 'Next: set up campaign' opens `/campaigns?…&review=1`, which prepares Review on its own (#1004, #1152); 'Review ads' and 'Make another' stay in the quieter row above. Up to two 'Coming up' occasion chips (festivals and seasons for today's date in IST, `src/lib/seasonal.ts`; November adds Chhath Puja, Guru Nanak Jayanti and the winter season, and a festival comes before a long season, #1210) fill the goal in one tap with plain words ('An ad for Chhath Puja from <Business>.'); they never assert a sale, discount or deadline, and the concept prompt and claim check allow only saved offers (#700, #1153) |
| `/studio` | Generate, inspect, approve, edit (ad text, words on picture, background); every ad tile here, in Create step 2 and on Go live says **Your photo** or **AI picture** (#1901, Hindi too), and only a Your photo ad may say "our work" (#1617); regenerate (asks first), delete, export, share approved ads (phone share sheet; desktop downloads and copies the text); "Create campaign (N)" links approved ads to Campaigns | Approval and sharing do not publish an ad on Meta |
| `/assets` | Browse/reuse/download saved images | Download/clipboard failures are surfaced |
| `/campaigns` | Draft, review, create paused, activate/pause, sync, report; `?new=1&creatives=<ids>` opens the composer with those approved ads selected; `&review=1` (#1004, from Create) then prepares Review on its own once Meta is connected, the WhatsApp check has run and a form campaign has its lead form (the same prepare as the Review button; nothing is sent to Meta). The lead form used for the last Review is preselected while the Page still has it; with several forms and none chosen, the field says choosing one opens Review | Live Meta writes require verified binding and capability |
| `/leads` | WhatsApp chats per campaign with **Add enquiry** (#764) first; the form table follows as "Form enquiries (n)", folded when there are none (#1223), or plain "Enquiries (n)" once a WhatsApp chat is logged in it, and the strip then says "n chats logged" instead of "No chats started yet" (#1835); the "No enquiries yet" block is decided on arrival, so a tab with nothing in it keeps the tabs (#1810); then sync, search, and inspect enquiries; copy digest. Each enquiry with a phone has **WhatsApp them** (wa.me with a first reply in the business's first language, en/hi/Hinglish, naming the business and its first offer) and **Call**; the first tap records `first_contacted_at` ("Replied 12 min after the enquiry", #1049) | No automated outreach is sent: the owner sends the reply |
| `/settings` | Meta connection, spend guardrails, declared preferences, **App language** (English · हिंदी, kept in the `adbrain_lang` cookie for a year; Home, the first-ad card and WS1 step 1 follow it, other screens follow screen by screen, #1438; strings in `messages/{en,hi}.json`; WS1 step 1 offers English / हिंदी until the cookie is set, English by default and never from the browser, #1641) | Disconnect does not pause running ads; preferences cannot authorize spend |
| `/settings/verdicts` | Internal only (#1255): one example of each campaign-card state for team walks | Fixed examples; reads and writes nothing; 404 for owners |

## Workspace Responsiveness

Sidebar links retain Next.js automatic prefetching and request full destination
prefetch after hover, keyboard focus, or touch intent. Current-section links do
not request full prefetch. Next.js owns cache reuse and invalidation; navigation
still shows its pending indicator. A responsive, reduced-motion-aware skeleton
replaces the spinner-only page fallback while the workspace shell stays usable.

Campaign results start loading as soon as the campaign page is available, without
waiting for approved creatives or connection metadata. Campaign status selection
and clearing search fetch immediately; typed searches retain a 250 ms debounce
and obsolete requests are cancelled.

Settings connection controls and spend guardrails stream independently, with
section-local loading and error states. Unavailable spend data does not become
editable default limits. These changes do not bypass authorization, publishing
preflight, or spending checks, and do not eliminate database or provider latency.
Source behavior is not a production latency benchmark or deployment receipt.

## Public Surface and Operations

Landing/legal pages and `/guides` provide public metadata, structured data,
sitemap, and social images. Workspace pages are authenticated and noindex; robots
rules are indexing hints, not access control. No search-ranking guarantee follows
from metadata correctness.

`/ideas` and `/ideas/<industry>` (#289) show three real AdBrain ads for each of ten
example local businesses, labelled as examples, made by `scripts/make-idea-ads.ts`
with the production Create pipeline (no phone numbers, evergreen offers). "Make one
like this" saves the idea's goal in localStorage and opens Create, which starts from
it after sign-in; the login page keeps the create-account view while it's pending.

`/for/solar`, `/for/ielts` and `/for/interiors` (#1565, #1315) are static leave-behind
landings for the pilot segments (`src/lib/segments.ts`): the segment's headline, a
WhatsApp chat showing what a customer sends, the pilot kit's offer (free first
campaign, the owner pays Meta from their own ad account, then ₹999 a month with the
first month free) and trust lines, with "Start my free campaign" → `/login`. The
"Message us on WhatsApp" button appears when `SUPPORT_WHATSAPP` (or
`NEXT_PUBLIC_SUPPORT_WHATSAPP`) is set at build time (#796). No margin, no promised results.

Owner activity records, AI usage events, and structured product telemetry serve
different purposes. See [Observability](../operations/observability.md) for privacy, access, and
best-effort persistence; do not call an owner-insertable audit log tamper-proof.

## Known Limits

- Public customer Meta consent/app review must be verified separately from code
  and an operator's existing system-user connection.
- Generation quota is a non-atomic preflight; telemetry can undercount failures.
- Generation recovery is not durable job scheduling or exactly-once billing.
- Database, Storage, and Meta do not share a transaction.
- Remote campaign disappearance does not automatically delete local mirrors.
- Billing/subscriptions, team roles, self-service agency management, Google Ads,
  video generation, automated outreach, scheduled campaign activation, and general
  winner-based budget optimisation remain outside current product workflows.
- AI output validation is not independent factual, legal, or advertising-policy
  certification. Review output and measure real lead quality.
