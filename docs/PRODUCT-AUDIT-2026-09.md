# Customer-Focused Marketing: Product Audit

Reviewed 2026-09-07. Source inspection and local browser validation; not a live
Meta launch, a paid-generation evaluation, or a claim of commercial readiness.

## Positioning

**AdBrain. Reach the right customers.**

AdBrain helps local businesses turn their brand and customer goals into
marketing creative, reviewed Facebook and Instagram campaigns, and enquiries
they can follow up on. This is a product purpose, not a guarantee of delivery,
lead quality, bookings, or revenue.

Use customer outcomes at the entry points: reach, enquiries, visits, and
conversations. Keep precise operational names at decision points: ad creative,
lead form, daily budget, paused campaign, activate. Creating images is not the
same as creating or activating a campaign. Avoid implying omnichannel campaign
publishing, automated outreach, or a CRM workflow that does not exist.

## Implemented In This Pass

- Replaced solar-first landing imagery and copy with food/drink, fitness, and
  home-service examples. Industry selection changes brand, audience, goal,
  photograph, headline, body copy, CTA, and photo-source link together.
- Hero now shows rasterized example creative, not an unrelated analytics UI.
  Desktop and mobile crops use the same authored, explicitly fictional examples.
- Aligned sign-in, Create, onboarding, Home's first task, social preview, and
  site metadata around customer-focused marketing. Removed solar placeholders
  from new-business setup without changing existing customer data or prompts.
- Removed unsupported "in seconds", "one-click launch", guaranteed brand-fit,
  and zero-price structured-data claims. Explained Meta eligibility, paused
  creation, activation, human review, and spending limitations.
- Verified that lead status tracking is absent and removed that proposed claim.
  The actual product supports manual lead sync, contact details, and digests.
- Fixed email-only enquiries being counted as contactable but having no visible
  contact address. The inbox now exposes phone and email links.

## Priority Findings

| Priority | Evidence | Customer Risk | Next Change And Acceptance Gate |
| --- | --- | --- | --- |
| P0 | `src/lib/meta/credentials.ts`: `resolveMetaCredentials` falls back to environment credentials when stored credentials are absent, incomplete, or expired; `getMetaConnection` can report expired OAuth while execution uses that fallback. | A business may operate against the server's shared account or Page rather than the account it expects. | Explicitly bind any legacy environment connection to one business; fail closed on lookup errors and expired/incomplete OAuth. Test two businesses, missing rows, denied reads, and expired tokens. Verify existing demo migration before changing production configuration. |
| P0 | `src/app/api/campaigns/create/route.ts`: Meta/form requests occur before business lookup; creative lookup filters approved IDs but not `business_id`. | Invalid business requests can invoke shared Meta credentials, and an owner with multiple brands can mix one brand's creative into another brand's campaign. RLS does not prevent same-owner brand mixing. | Validate owned business first, scope creative IDs to that business, and reject mismatches before any Meta call. Add a two-brand API test asserting zero external calls on rejection. |
| P0 | Both campaign create and plan routes initialize nationwide India and swallow geo-resolution failures. `src/lib/meta/client.ts` defaults missing geography to `IN`; planner exclusions are best-effort. | A local campaign can be created for a much broader or wrong-country audience after a lookup failure. | Fail closed for unresolved inclusions/exclusions. Make nationwide targeting an explicit confirmed choice. Tests must prove no Meta creation when requested locations cannot be resolved. |
| P1 | `src/lib/meta/client.ts`: `createLeadCampaign` creates a campaign before uploads and child objects, with no rollback. The plan route ignores the campaign insert error after external creation. | Failed requests leave orphaned paused objects; retries can duplicate campaigns, and a successful external creation may not appear in AdBrain. Paused state reduces immediate spend risk but does not provide recovery. | Introduce a durable operation/idempotency key, tracked external IDs, and reconciliation/compensation. Inject failure at every creation/persistence stage and prove retry does not duplicate the campaign. |
| P1 | `src/app/api/campaigns/plan/route.ts`: a ready AI plan immediately creates Meta objects; invalid creative/form IDs can fall back to other available choices. | Customers see the final account, form, creative, destination, location, and budget after the external operation, rather than confirming the complete proposal first. | Separate proposed plan from confirmed creation. Require an explicit preflight showing Page/account, chosen creative, resolved geography, exclusions, total budget, destination, and paused state. No external writes until confirmation. |
| P1 | `src/lib/campaign/planner.ts`, `src/lib/utils.ts`, and `src/lib/creative/summary.ts` assume INR; seasonal suggestions and location defaults assume India. | Industry-neutral does not mean geography-neutral. A US demo and an INR account can create confusing or incorrect financial context. | Read account currency and persist business country/timezone. Until supported, state the supported market and block incompatible accounts instead of silently relabelling money. Add a non-INR account fixture. |
| P1 | `src/lib/supabase/queries.ts`: campaign, result, lead, and spend-limit reads discard errors and return empty/default values. | An outage can appear as no enquiries, no campaigns, or no spend limit. It undermines trust and may weaken safety decisions. | Distinguish empty, failed, and stale reads. Preserve last-known results with timestamps; fail closed on financial authorization. Simulate unavailable tables/RLS errors and assert a visible recoverable state rather than zero metrics. |
| P1 | `src/components/lead-inbox.tsx` and lead schema: no owner, contact status, follow-up date, or outcome; table is a wide scroll surface on mobile. | The product stops at collecting responses, leaving the most valuable customer task outside the workspace. | Add new/contacted/qualified/closed status, notes, next action, and mobile contact rows. Measure time to first response; add alerts only with delivery/consent controls. Existing email visibility defect fixed in this pass. |
| P2 | `src/components/ad-assistant.tsx`: generation uses a long HTTP request and session-local recovery. | Closing/reloading during paid work can lose usable progress; retry can create additional cost. | Durable generation jobs with a stable ID, partial-result recovery, and named phases. Prove reconnect/reload resumes the same operation without another paid request. Timing copy corrected here, job architecture not implemented. |
| P2 | Landing examples remain authored copy and stock photos, not verified pipeline output or customer results. | The product story is clearer but still lacks evidence of actual generation quality or marketing effectiveness. | Publish permissioned, representative generation examples with original brief, edit history, and review notes. Benchmark quality separately from real campaign outcomes; do not imply measured ROI before obtaining it. |

## Recommended Sequence

1. Resolve account ownership, cross-brand selection, and geography safety.
2. Add confirmation preflight and recoverable/idempotent campaign creation.
3. Make data failures visible and establish currency/account compatibility.
4. Complete enquiry follow-up and mobile contact workflows.
5. Add durable generation recovery and authentic creative-quality evidence.
6. Validate pricing and Meta onboarding eligibility before broad acquisition.

These are scoped recommendations, not implemented backend changes. No Meta
campaign, billing configuration, customer record, or provider key was changed
during this audit. No paid AI calls were required.

## Reproducible Visual Checks

With an existing local server: `node scripts/check-marketing.mjs`.
Override the origin with `MARKETING_CHECK_URL` when needed. The isolated
Chromium check covers 1440, 1024, 768, and 390 CSS-pixel widths, loaded images,
overflow/clipped text, example switching, keyboard selection, FAQ expansion,
runtime errors, and next-section visibility. Private captures go under
`test-results/marketing/`. Inspect screenshots as well as automated assertions:
the first crop passed geometry checks but hid the artwork on mobile.

`node scripts/generate-marketing-preview.mjs` regenerates the checked-in hero
bitmaps from the current illustrative posters. This does not call an AI model.
If example content changes, regenerate both crops before repeating visual QA.

Photo assets are downloaded from Unsplash, with source links on each example:

- Coffee: `photo-1495474472287-4d71bcdd2085`.
- Fitness: `photo-1571902943202-507ec2618e8f`.
- Interiors: `photo-1600210492486-724fe5c67fb0`.

These photographs do not depict real AdBrain customers or prove an AI output.

## Validation Results

- Typecheck and ESLint passed.
- Coverage gate passed: 697 tests passed, one live test skipped; statement
  coverage 61.95%, branch coverage 57.65%.
- Optimized Next.js production build passed.
- Isolated browser checks passed at all four widths; desktop, tablet, and
  mobile screenshots were reviewed and the mobile artwork crop corrected.
- Development Chromium reports React's CSP/`eval` debugging warning. No
  production security policy was relaxed. Existing macOS duplicate-libvips
  and jsdom navigation warnings did not fail the test suite.
- Deployed on 2026-09-07 to `adbrain.vanshul.com` and `adsvanz.app` using Vercel
  deployment `dpl_BqGfSSSSpVSdYDxnf8EJJ2EUxusF`. All four browser-width checks
  passed against the production domain. Source changes remain uncommitted.
  No authenticated live campaign end-to-end check was performed in this pass.