# Production Verification: 2026-09-18

## Scope and Result

Tested `https://adbrain.vanshul.com` at release
`28766f9eaec523be3782cd015b15c62d04d80982` after
[PR #14](https://github.com/vanshulgoyal101/adbrain/pull/14).
The owner approved temporary test drafts/assets and explicitly declined paid
calls and Meta mutations. Existing account records and settings were not to be
changed. No application code was changed or redeployed during this verification.

The scoped suites finished with **87 API checks and 90 browser checks passing**.
Follow-up checks confirmed real saved-generation owner isolation, the telemetry
origin gate, and Storage cleanup. No unresolved application failure was found in
the exercised paths. This is not certification of every feature, browser, account,
provider or campaign delivery behavior.

## Coverage

| Area | Live evidence |
| --- | --- |
| Public HTTP | Homepage, login, privacy, terms, data deletion, guides/index and both guides, robots, sitemap, manifest, social image, favicon and expected 404 |
| Public layouts | Eight pages at 1440, 390 and 320px; no horizontal overflow; guide screenshot inspected |
| Protected pages | Eight anonymous workspace requests redirected to login |
| API authentication | 27 anonymous method/path probes rejected with 4xx; no successful protected operation |
| Signed-in workspace | Demo and development accounts, eight sections at 1440/390px: 32 route/viewport/account visits |
| Login/logout | Actual production password UI login and mobile signout, followed by protected-page redirect |
| Ownership | Cross-owner business reads hidden by RLS; foreign draft/status access denied; draft update by the other owner denied |
| Generation recovery | Owner sees a real saved group; other owner sees zero rows; no generation request made |
| Invalid inputs | Empty assistant/generation/planner/autofill/draft inputs and zero spend cap rejected before business mutation or paid work |
| Draft API | Create/read/edit/version increment; stale update/delete conflict; foreign-owner denial; cleanup, both accounts |
| Draft browser | Save/reload/reopen/edit/reload/delete at 1440 and 390px; actual UI delete removed the row |
| Create UI | Unsent multiline goal survives navigation; no interview or generation submitted |
| Review UI | Search/no-results/reset, approved filter, preview/Escape/focus return, variant/placement controls; no approval or regeneration mutation |
| Campaign UI | Search/status filtering, manual/guided switching, A/B total, new-composer reset; no preflight, creation or activation |
| Assets | Stored images render; real clipboard copy and individual image download in both accounts at both widths |
| Export/report | One persisted creative exported per account; ZIP copy plus raster checked, zero skipped images; stored campaign Markdown report downloads |
| Brand upload | Missing-file validation; one labeled product-photo upload, render/reload/delete; brand logo unchanged |
| Settings/navigation | Zero-cap client rejection without saving; desktop links and mobile menu/Escape/focus/navigation |
| Read-only Meta | Existing bound Page returned four forms; real location query returned results |
| Telemetry boundary | Foreign-origin event POST rejected with 403 |

No workspace JavaScript page errors or failed GET responses were recorded.
Stored images were not replaced with fixtures. Legacy `image.pollinations.ai`
URLs were deliberately blocked to avoid generator calls; their placeholders are
not evidence of broken stored media or successful legacy-image delivery. External
analytics requests were also blocked. No complete creative-quality review was
performed.

## Safety and Cleanup

Browser writes were denied by default. The write allowlist permitted only the
named temporary draft IDs, one labeled product-photo row/object, and required
authentication operations. Product-photo deletion's conditional logo-clear
request matched only that temporary image URL, not the existing logo.

Before/after fingerprints matched for each account's existing businesses,
creatives, campaigns, brand assets, campaign drafts, spend limits, instructions
and leads. All temporary draft rows, the uploaded asset row and its Storage
object were confirmed absent afterward. Authentication, rate-limit and normal
server telemetry records may have changed as part of testing; those are not
covered by the unchanged-business-data claim. Browser contexts were closed,
operator API sessions signed out locally, and no server was started.

## Test Corrections

- Generation recovery returns HTTP 200 with an empty RLS-filtered result for an
  inaccessible group, not 403/404. Retesting real saved groups established that
  owner rows were present and cross-owner rows were absent. `processing` still
  means no visible rows, not proof of an active generation job.
- The saved-draft button includes budget text in its accessible name. Correcting
  the exact-name selector allowed the browser lifecycle to pass. Screenshot setup
  also needed to accept an already-open composer after deletion.
- An unauthenticated foreign-origin spend probe returned 401; it tested auth, not
  a global CSRF gate. The explicit telemetry origin check was tested separately.

These were harness assumptions, not application fixes. Earlier failed attempts
also cleaned up their temporary records.

## Unverified and Operational Cautions

- Paid interview, website extraction, planning, generation, regeneration, image
  quality and timeout recovery were not exercised with real model calls.
- Campaign preflight/create/activate/pause/delete, lead/campaign sync, results
  refresh and cron enforcement were not executed. They can write data or alter
  live ads even when their names sound read-only.
- Customer Meta consent, reconnect/disconnect, Google login, magic-link email
  delivery, existing-brand/instruction/spend saves and creative approval changes
  remain outside this run. Chromium was used; Safari/Firefox were not tested.
- Enquiries used existing data; no synthetic leads or live sync were added to
  manufacture a populated inbox. Not every loading/error/provider failure state
  was induced in production.
- The demo's Cedar Ridge profile remains connected to Solaride Meta assets, as
  previously documented. Do not launch clinic ads through that binding merely
  because connection status and Page-form reads pass.
- This was functional verification, not a load test or a new latency benchmark.

Private local evidence is in `/tmp/adbrain-production-api-report.json`,
`/tmp/adbrain-production-browser-report.json` and
`/tmp/adbrain-production-audit-*.png`. Those temporary artifacts are not committed
and may be removed by the operating system. No credentials or response bodies
containing customer records are included in this report.

## Production Snappiness Follow-Up

A subsequent owner-requested latency run used the same release and existing
no-paid/no-Meta-mutation limits. It collected 40 complete authenticated HTML
responses (five per route), 80 real navigation clicks (five per route at each
viewport), and interaction/request timings on the connected demo account.
Three temporary drafts were created, edited and deleted; cleanup was verified.
No application code, deployment, configuration or existing business record was
changed. The earlier functional suite should not be read as a latency guarantee.

### Navigation

Times below are median milliseconds. HTML includes consuming the entire response,
not just headers or a streamed loading shell. Click-to-ready uses a browser-side
event timestamp and waits for the destination path, heading, identifying control
and completed navigation pending state. It does not wait for every image to decode.

| Section | Complete HTML | Desktop click-to-ready | Mobile viewport click-to-ready |
| --- | ---: | ---: | ---: |
| Home | 902 | 907 | 752 |
| Create | 607 | 631 | 598 |
| Review | 650 | 1,054 | 830 |
| Campaigns | 609 | 766 | 715 |
| Enquiries | 595 | 647 | 552 |
| Brand Brain | 590 | 674 | 706 |
| Assets | 573 | 698 | 678 |
| Settings | 582 | 664 | 764 |

Navigation pending feedback appeared at a median 14ms (maximum 82ms). Median
RSC request duration was 473ms. Most navigation is responsive but not instant;
Review exceeded the approximate one-second target on desktop. Home's first HTML
sample took 4,318ms, versus its fastest 578ms sample. This is a first-observed
request spike, not independently proven to be a server cold start.

### Interactions and Actions

| Action | Observed timing | Interpretation |
| --- | --- | --- |
| Preview open/close, Review search/reset | 5-15ms medians | Fast local updates |
| Navigation feedback | 14ms median | Clicks acknowledged promptly |
| Campaign filters/modes/A-B totals, goal editing, mobile menu | 23-31ms median event-to-two-frames in follow-up | Local feedback generally fast |
| Lead-form GET | 2,100ms median; 1,765-3,304ms, 12 completed requests | Principal repeatable provider-backed wait |
| First location query | 1,484ms desktop; 1,668ms mobile viewport | Includes debounce and live Meta query; one sample per viewport |
| Cached location query | 18ms desktop / 11ms mobile medians | Repeated search is fast |
| Stored-image download | 279ms desktop / 555ms mobile medians | Three samples per viewport; one specific stored image |
| Temporary draft create | 709ms median, 1,642ms maximum | Three live API samples |
| Temporary draft update | 768ms median, 975ms maximum | Three live API samples |
| Temporary draft delete | 709ms median, 1,017ms maximum | Three live API samples |

The initial mobile Campaigns sequence had 24 main-thread tasks over 50ms, up to
404ms, and composer open/close medians of 116/121ms. A fresh-context repeat had
30/31ms median event-to-two-frames, with an opening outlier of 148ms; median
script/layout/style costs were about 5/2/3ms on opening. These different metrics
must not be conflated, but the repeat does not support a consistently expensive
toggle. Investigate intermittent contention before attributing it to React or
changing layout code. Desktop also had a 161ms opening outlier in the repeat.

### Priorities From Evidence

1. Avoid a new blocking form wait on every composer reopen. The current effect
   fetches again whenever setup opens. A short component-local freshness window
   with explicit retry and invalidation on reconnect/business change is a candidate;
   server preflight must still verify the current form before creation. This is
   a recommendation, not an implemented or measured optimization.
2. Reduce remaining navigation/auth/database waits, especially Review and Home.
   Profile request stages before changing authentication or router freshness.
   Do not replace verified identity checks with untrusted session data or add
   cross-account caches to chase a faster number.
3. Capture intermittent mobile Campaigns long tasks on a real phone under a
   controlled workload before choosing rendering changes.

### Measurement Limits

- Chromium ran on the same Mac/network at 1440px and 390px. A narrow viewport is
  not a low-end phone, cellular simulation or Safari test. No CPU/network throttle
  was applied. Sequential desktop then mobile samples can benefit from warmed
  services; they are not a device-speed comparison.
- Three/five samples are diagnostic medians/ranges, not reliable p95/p99, RUM,
  load-test results or a service-level guarantee. The browser event-to-ready and
  event-to-two-frames measurements are not standardized INP measurements.
- Browser writes and external analytics/generator requests were blocked. Stored
  public images were allowed. Route interception changes browser caching behavior,
  so this is not an exact reproduction of normal repeat-visit cache performance.
- Paid AI, regeneration, successful brand/instruction/spend saves, uploads,
  approval changes, exports, auth and sync/ad operations were not latency-benchmarked
  in this follow-up. Some were functionally tested above; that is separate evidence.
- No browser page errors occurred. All temporary latency-test drafts were absent
  afterward; browsers closed and operator sessions signed out locally.

Raw local timing artifacts: `/tmp/adbrain-production-snappiness.json` and
`/tmp/adbrain-snappiness-controls.json`. A readiness selector initially assumed
Review used an aria-label rather than a wrapping label; correcting the probe
allowed the full run to complete without changing the application.

## Snappiness Fixes Prepared for Release

The owner subsequently requested fixes and production promotion. This section
supersedes the no-code-change status above for the follow-up implementation,
not the historical timing measurements.

- Campaign setup now reuses a successful lead-form response for 60 seconds within
  the mounted component, scoped to owner, business and retry/reconnect generation.
  Empty successes are reusable; failed and cancelled requests are not. Reconnect,
  retry, scope changes and expiry fetch again. Freshness is checked on setup open,
  not by a polling timer. No persistent or shared server cache was introduced.
- Form choices are not automatically selected on reopen. Explicit guided-review
  refresh and server launch preflight remain unchanged; UI freshness never
  authorizes campaign creation or spending.
- Review still starts creatives and demo usage reads concurrently, but its optional
  usage summary streams behind Suspense after the editor. Slow usage reads no
  longer block editor rendering or insert content above its controls afterward.
  This removes a proven dependency, not a measured universal navigation speedup.
- Home's isolated 4.3-second first request and intermittent browser contention
  remain unattributed. This release does not claim to eliminate those outliers or
  accelerate first-time live Meta lookups.

Local release gates passed: 1,255 tests with one opt-in skip, coverage
77.64% statements / 69.75% branches / 76.80% functions / 80.15% lines, lint,
typecheck, zero dependency vulnerabilities, isolated PostgreSQL fresh/upgrade
checks and a 54-route production build. Focused tests exercise reuse, exact expiry,
reconnect, owner/business invalidation, empty results, failure, late cancelled
responses and editor rendering while usage remains unresolved.

Read-only browser checks passed at 1440px and 390px against an isolated local
server using the real demo identity and fixture forms: zero requests on the list,
one on first setup, no additional requests across three reopens, and a second
request after advancing the browser clock 61 seconds. Selection stayed empty;
Review search and the usage report worked, with no page errors or horizontal
overflow. Local reopen timings were 15-48ms, not production results. External
generator images and all mutations were blocked. The local launcher initially
lacked the production-only decryption setting; it was supplied in process memory
only for read-only connection status. No credentials were written or changed.
Browser sessions signed out locally and the temporary server stopped.

No schema, environment, quota, authorization or live ad changes are part of this
release. Hosted CI, exact deployment identity and live workflow evidence will be
recorded in the release PR after promotion. Rollback is a reviewed revert of the
application commit through the same required checks; no data rollback is needed.