# Workspace UX Revision

Implementation and verification record for the September 7 workspace revision.
Included in the workspace and canonical-brand release. No schema, provider,
billing, or credential changes. See [brand identity](../BRAND-IDENTITY.md) for
cross-site assets and production verification commands.

## Delivered

- Shared business identity, current-section header, skip link, and a native
  modal mobile menu with Escape dismissal and focus restoration.
- Self-hosted DM Sans, neutral surfaces, smaller consistent controls, restrained
  borders, and compact page headers. Public editorial styling remains separate.
- Campaigns opens on management for returning users. New setup is explicit;
  manual and guided setup are mutually visible and preserve drafts when hidden.
  Name search and status filters include a recoverable no-results state.
- A/B setup shows the total daily budget across both ad sets. Review describes
  paused creation, not guaranteed Meta eligibility. Unsupported lead projections
  were removed; form names, audience details, and actions wrap on mobile.
- Enquiries supports search, contact availability, sorting, phone and email
  actions, and mobile stacked rows. The all-enquiry digest is collapsed after
  results in both visual and document order. No CRM status tracking is implied.
- Create emphasizes the editable customer goal and actual saved brand context.
  Multiline input is preserved. Keyword-derived audience/offer guesses were
  removed; starter goals ask for confirmation of commercial details.
- Asset previews show complete artwork rather than cropping logos and posters.
- Internal Meta tools are collapsed in Settings. Spend controls explicitly warn
  that periodic checks and failed pauses can allow spending beyond the cap.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:coverage`: 702 passed, one live-provider test skipped; configured
  coverage thresholds passed (statements 61.58%, branches 56.93%, functions
  63.94%, lines 62.1%).
- `npm run build`: production build passed.
- `npm run test:workspace-browser`: existing Home-to-Review flow passed at
  1440, 1024, 768, and 390 pixels against the production build.
- `npm run test:workspace-ux`: eight authenticated routes at the same four
  widths; checked document overflow, image loading, runtime errors, campaign
  composer visibility and retained drafts, A/B budget totals, multiline goals,
  enquiry filtering, Settings disclosure, and mobile menu behavior.
- `node scripts/check-marketing.mjs`: all four widths passed image, overflow,
  example switching, keyboard, and FAQ checks after shared theme changes.
- Screenshots manually inspected for desktop and mobile composition. Private
  screenshots are ignored under `test-results/`; Playwright can clear that folder.

The workspace UX harness requires the existing localhost server and development
login environment. It intercepts non-GET API calls with fixtures or safe errors:
no paid AI generation, real campaign creation, activation, or lead import occurs.
It reads the development business and signs out its own test session afterward.

## Limits

This is not a backend safety certification. Credential fallback, campaign
ownership validation, geography fallback, external-operation recovery, and
follow-up workflow gaps remain in the [product audit](../PRODUCT-AUDIT-2026-09.md).
Collapsing developer controls is a presentation change, not an authorization
boundary. INR and Meta-account assumptions remain. No accessibility conformance
claim is made; keyboard, focus, responsive layout, and reading order were checked.

Existing macOS duplicate-libvips and jsdom navigation warnings did not fail the
suite. Dependency security remediation is outside this UI revision.