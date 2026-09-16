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

## Remaining Audit Work

- API input validation, auth/tenant boundaries, database
  policies, public metadata/discovery, and frontend workflow checks are separate
  audit batches, not covered merely by the outbound-fetch tests.
- Real Meta consent remains an external gate. Local mocks cannot prove it works.
- Technical SEO can improve crawlability and relevance; ranking depends on search
  engines, competition, content quality, and authority. No universal first-place
  ranking claim is made.