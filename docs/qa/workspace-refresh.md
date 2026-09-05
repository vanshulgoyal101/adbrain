# Home and Review Refresh

Validated locally on 2026-09-05. This is partial delivery of roadmap phases B,
C, and E, not a whole-product readiness signoff.

## Delivered

- Light, compact shared shell; readable mobile navigation and `aria-current`.
- Home work queue derived from actual brand/creative/campaign/connection state.
- No unconditional brand-ready claim or active status for paused campaigns.
- Direct draft, approved, and selected-creative links from Home to Review.
- Parallel independent dashboard queries instead of serial reads.
- Selectable Review board, full creative inspector, status and text filters.
- Compact horizontal thumbnail strip on mobile; split board/inspector on desktop.
- Approval and deletion errors remain visible and retryable; local state changes
  only after successful actions. Existing generate/regenerate/export behavior stays.
- Enlarged preview traps Tab focus and restores its trigger on close.

## Verification

- Full Vitest coverage gate: 73 files / 643 tests passed.
- Focused Home, queue, navigation, and Review suites: 38 tests passed.
- TypeScript, ESLint, and production build passed.
- Standalone Chromium: four read-only authenticated Home-to-Review tests passed
  at 1440, 1024, 768, and 390 CSS pixels using existing local-account data.
- Browser checks cover actual image loading, page overflow, sidebar breakpoints,
  Home draft deep link, inspector selection, search recovery, and preview focus.
- First-run and missing-context behavior are unit-tested, not browser-verified.
- Mutation failure/success paths are tested with mocked server actions. No ads
  were generated, approved, deleted, or activated by browser validation.

The shared VS Code browser returned inconsistent captures while the shared tab
was changing routes. Those captures are not acceptance evidence. The standalone
Playwright output is the authoritative responsive evidence for this change.

## Reproduce

Use Node 22 with support for `--env-file-if-exists`. The existing local test
account must have at least two draft creatives with working images. Put its
`DEV_LOGIN_EMAIL` and `DEV_LOGIN_PASSWORD`, plus the usual public Supabase URL
and anon key, in the gitignored `.env.local`. Do not commit credentials.

```sh
npm install
npx playwright install chromium
npm run build
npm run test:workspace-browser
```

The suite targets only `http://localhost:3939`. It reuses an existing server on
that port or starts the production build and stops its own server afterward.
Stop a stale server first when testing a newly rebuilt app. Session cookies stay
in memory. Trace/video recording is off. Full-page screenshots are saved under
`test-results/workspace-Home-to-Review-at-<width>px/`; that output is gitignored
because it can contain real account data. Inspect before sharing externally.

## Remaining Gates

The other authenticated routes have not had the same four-width visual review.
Explicit side-by-side comparison, editing/rejection, placement variants, richer
generation-progress recovery, lead follow-up tasks, and customer task studies
remain open. Database query helpers still collapse some read errors to empty
results; this pass did not redesign that shared error contract.

`npm audit --omit=dev` reports four high-severity entries in the existing
production dependency tree (nanoid, PostCSS, Sharp, and the dependent Next.js
entry). Fully resolving the report requires changing pinned Next.js 16.2.12;
no forced framework upgrade was included in this UI change. These advisories
are not a demonstrated application exploit, but require a separate upgrade pass.