# Security and Quality Audit: 2026-09-16

## Scope and Evidence Rules

This is an incremental source audit, not a certificate that every vulnerability
has been eliminated. Development starts from `0614813` on `dev`. Production
promotion follows [RELEASING.md](../RELEASING.md); Git publication does not
authorize migrations, credential changes, paid model calls, or Meta mutations.

Each completed batch records the controlling code, regression checks and limits.
Existing product and proposed-feature inventories remain in
[FEATURES.md](../FEATURES.md) and [ROADMAP.md](../ROADMAP.md).

## Outbound URL and Media Boundary

Confirmed defects in the previous hostname-only guard:

- URL-normalized IPv4-mapped IPv6 bypassed dotted-IP checks, including loopback
  and cloud metadata addresses. IPv6 link-local coverage was incomplete.
- Trailing-dot localhost and shared-address IPv4 were accepted. Prefix-based
  IPv6 detection also blocked ordinary domains such as `fda.gov`.
- Public-looking DNS names could resolve to private addresses; checking a name
  without binding the connection to a validated answer was insufficient.
- Website bodies were buffered before enforcing a character-count limit, not a
  streaming byte limit. Chunked or dishonest content lengths could bypass the
  early check and consume excessive memory.
- Media downloads, Meta image uploads and renderer image inputs did not share
  the URL guard. Meta uploads also buffered an unbounded body.

The shared transport in `src/lib/security/ssrf.ts` now uses `ipaddr.js` for
address classification and an Undici dispatcher whose connection lookup rejects
the entire DNS answer set if any address is non-public. The validated address is
passed directly to the connection callback, preserving the URL host for HTTP/TLS.
Every redirect is checked, with one deadline across hops. Credential-bearing URLs
are rejected; sensitive headers cannot cross origins. Rejected/redirect bodies
are cancelled. Text is streamed under a decoded-byte budget.

Remote images use this transport and a bounded reader. Image execution and
compositing accept validated single PNG/JPEG/WebP rasters, including bounded
inline base64 inputs, with the existing 20 MB and 40-million-input-pixel limits.
The compositor resolves both background and logo to inline PNGs before rendering.
Unsupported or inaccessible assets fail explicitly; no raw-photo fallback is
presented as a finished creative. Meta upload transport is bounded but does not
re-encode the stored finished image.

Regression homes: `tests/ssrf.test.ts`, `tests/image-execution.test.ts`,
`tests/meta-client.test.ts`, and `tests/creative-raster.test.ts`. The raster suite
renders all four formats at all three text placements. Network tests mock DNS or
providers; no paid generation, customer consent or live campaign action is implied.

Residual operational controls: private DNS/egress restrictions are still useful
defense in depth; any future user-controlled server download must use this
transport. Fixed provider APIs have separate timeout/authentication policies.

## Dependency Baseline

The September 16 npm audit reported five affected dependency entries: Next.js
(critical), its nested Sharp and PostCSS, plus js-yaml and nanoid (high). The
Windows-specific Next advisory is not proof of exposure on Vercel/Linux; the
image-optimization and transitive parser advisories still warranted updating.

Updated Next and eslint-config-next together from 16.2.12 to 16.3.5 and refreshed
compatible js-yaml/nanoid resolutions without force upgrades. `npm audit` then
reported zero vulnerabilities and the production build passed. The duplicate
Sharp/libvips warning seen before the upgrade was absent afterwards.

CI now uses Node 22 and runs `npm run audit:dependencies` after installation.
This checks development and production dependencies and fails at high severity.
Registry availability/advisory changes can fail the gate independently of source
changes; investigate rather than silently disabling it. Use a maintained Node 22
release locally (22.13 or newer for the current ESLint dependency engine range).
The audit is a dated registry result, not a guarantee that dependencies are safe.

## Authentication, Input and HTML Boundaries

- Auth callback destinations previously concatenated the origin with unvalidated
  text. An `@host` value could change the parsed destination host. Both code and
  email callbacks now accept only root-relative paths without authority, control
  characters or backslashes, falling back to the dashboard.
- Spend settings, website autofill, the retired Meta selection endpoint and the
  internal quota runner now use runtime schemas. Invalid JSON/types cannot become
  default spend settings or trigger work. Spend caps fit the database integer
  column. Autofill URLs are length-bounded before parsing.
- Autofill and spend settings return safe client errors instead of raw provider
  or database diagnostics. Direct route tests cover authentication, rate limiting,
  malformed inputs, budget-pool selection and zero side effects on rejected input.
- JSON-LD now escapes `<` before HTML insertion, preserving JSON semantics while
  preventing a future content field from closing the script element. Current
  structured data was server-authored; this is boundary hardening, not evidence
  that user-supplied script execution was possible in the current marketing page.

Regression homes: `tests/auth-callback.test.ts`, `tests/brand-autofill-route.test.ts`,
`tests/api-routes.test.ts`, and `tests/seo.test.ts`.

## Trusted Ledger and Rate Limits

`20260916_trusted_usage_and_rate_limits.sql` removes browser writes to usage
events and browser execution of the rate-limit RPC. Application writes/checks use
the server credential; owner-scoped usage reads retain RLS. A negative-value
constraint applies to new ledger writes, and a security-invoker aggregate counts
all monthly events rather than the first PostgREST page. Historical negative
tokens cannot reduce its result.

The rate-limit function validates parameters and locks by key before counting and
inserting, using a fresh wall-clock timestamp after acquiring the lock. Production
requests return 503 when shared protection is unavailable, not a weaker per-instance
fallback. Local development retains its in-memory fallback.

Verification uses temporary local PostgreSQL for fresh and ordered upgrades,
including repeated migration execution, browser privilege denial, nonnegative
ledger enforcement, 1,100-row aggregation, tenant isolation, and twelve concurrent
requests competing for three slots. Existing Meta transaction/race checks still
run. CI executes this harness using its installed PostgreSQL binaries and full Git
history for the pinned legacy baseline.

### Production Cutover Prerequisite

Not applied remotely during this audit. Review and authorize the exact migration,
verify the target and server credential, and schedule a coordinated code/migration
cutover. Deploying code first can temporarily return 503 because the new aggregate
and service-role RPC grant are absent; migrating first leaves old code unable to
write telemetry/use the browser RPC. Do not promote this batch independently of
its migration. A code rollback after migration must retain the trusted-client
changes, not restore browser access to the ledger.

The new check constraint is `NOT VALID` to avoid silently changing historical data
or blocking on a large validation scan. Audit negative legacy rows and explicitly
validate the constraint after investigation. No existing events are deleted or
rewritten by the migration. Usage recording remains best effort after paid work;
the monthly quota is a preflight check, not an atomic reservation or a hard-dollar
provider cap. Concurrent generations and failed telemetry writes remain limits.

## Public Discovery and Frontend Reliability

The public `/guides` index and two statically generated articles cover actual
AdBrain export sizes and Meta campaign readiness. Content lives in the typed
`src/lib/seo/guides.ts` registry. Adding a registry entry supplies static params,
sitemap discovery and related navigation; each article has canonical/social
metadata, Article/WebPage/Breadcrumb structured data, source photography and
official Meta reference links. Creative dimensions come from `AD_FORMATS`, not a
second manually maintained table. Unknown slugs return 404.

The sitemap no longer publishes a fabricated current modification date on every
request. Guide dates represent content edits. The shared app layout is noindex;
API, auth and connect responses also carry an X-Robots-Tag. These are indexing
directives, not access controls. Homepage/legal footers link to the guide index.
No fictional reviews, customer outcomes or performance claims were added.

Sign-out now checks resolved Supabase errors as well as exceptions, prevents
duplicate submission, and leaves a visible retryable failure instead of falsely
navigating away. Campaign CSV export uses a native download link. Brand asset
uploads reject unsupported declared MIME types before storage access and the
picker lists PNG/JPEG/WebP. This client check is usability validation, not proof
of valid bytes; server raster decoding remains authoritative. Existing SVG/GIF
assets need conversion before compositing, and spoofed or animated raster files
can still be rejected during generation.

### Final Local Verification

- Vitest: 998 passed, one skipped, across 123 passed files and one skipped file.
  Coverage: statements 67.94%, branches 60.09%, functions 68.13%, lines 70.27%.
- ESLint and TypeScript passed. Next 16.3.5 production build passed, including
  53 static-generation tasks and both new guide articles.
- npm audit: zero vulnerabilities on September 16. Temporary local PostgreSQL:
  49 passing checks across fresh and ordered-upgrade paths; no remote DB used.
- Chromium: all three guide routes at widths 1440, 390 and 320 returned 200,
  with no document overflow, loaded article images, canonical tags and parseable
  structured data. Unknown slug returned 404. Sampled API/auth/connect responses
  had `noindex, nofollow`. Desktop and mobile full-page screenshots were reviewed;
  local artifacts are ignored under `test-results/guide-*.png`.
- Browser server used placeholder Supabase auth. An initial shared analytics
  beacon was attempted; subsequent browser checks blocked all nonlocal requests.
  Local canonical origin was the configured localhost URL, not evidence of
  production canonical settings. Dev React logged its eval/CSP diagnostic;
  production CSP was not weakened to suppress it. Temporary servers were stopped.
- The full authenticated Playwright journeys were not rerun in this pass. Unit
  and local DB checks do not substitute for real consent or paid-provider tests.

### Published Batches

| Commit | Scope | Hosted CI |
| --- | --- | --- |
| `8a87d5b` | Outbound URL/media boundary | `35070625305` passed |
| `284c763` | Dependency update and audit gate | `35071039826` passed |
| `fb5b0cf` | Auth redirects and request schemas | `35071302129` passed |
| `1dbb4e9` | Trusted ledger and shared limiter | `35071677622` passed |

All publication in this audit targets `dev`. Production promotion and the new
database migration are not performed by publishing these commits.

## Remaining Audit Work

- Continue bounded review of fixed-provider OAuth timeouts, storage lifecycle
  recovery and high-volume usage-report pagination. These are follow-up review
  areas, not claimed fixed by this audit.
- Real Meta consent remains an external gate. Local mocks cannot prove it works.
- Technical SEO can improve crawlability and relevance; ranking depends on search
  engines, competition, content quality, and authority. No universal first-place
  ranking claim is made.