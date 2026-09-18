# Workflow integrity audit: 2026-09-18

Status: local, uncommitted fixes. No deployment, production data changes, paid generation, or live Meta mutations were performed.

## Confirmed fixes

- Campaign sync no longer imports unsupported Meta statuses as paused, overwrites a known foreign Page binding when the stored account ID is absent, or silently accepts duplicate-insert failures as successful imports.
- Campaign sync feedback retains skipped counts across pages, displays skips alongside pagination, replaces stale continuation notices on completion, and reports malformed success responses without losing the retry cursor. The last-completed timestamp updates only after the final page.
- Settings disconnect sends the displayed business ID, disables competing connection actions while pending, checks the response, preserves provider errors, and allows retry. It refreshes the connection only after confirmed success.
- The disconnect route rejects malformed JSON and invalid explicit targets without falling back to the primary business. Ownership errors receive controlled HTTP responses. Intentional no-body callers remain compatible.
- Password login uses the same local-only redirect policy as OAuth/email completion. All three login methods handle thrown failures, preserve returned provider messages, and expose pending states that prevent competing submissions.
- Markdown reports escape campaign names, newlines, formatting, and HTML. Pipe-delimited Solaride names stay inside one table cell. Impressions/clicks count as delivery, and a campaign with no leads is no longer called the best lead performer.

## Evidence

- Full local Vitest suite: 1,193 passed, one skipped across 131 files. This includes concurrent work from other sessions, not just this audit.
- ESLint, TypeScript, and production build passed; build generated 53 pages.
- Final disconnect parsing/formatting refinement: 66 route tests passed afterward.
- Actual login browser checks at 1440, 390, and 320 pixels: password failure/retry, mocked magic-link completion, sanitized callback, no horizontal overflow, and no page errors. All provider calls were intercepted; dummy credentials only.
- Screenshots: ignored `test-results/workflow-login-{error,sent}-{1440,390,320}.png`. Desktop and narrow-mobile failure screenshots inspected.
- Settings and campaign interactions were verified through component tests, not live disconnect/sync actions.
- Integrated browser navigation was unreliable; standalone Playwright completed the checks. The development CSP emits React's existing unsafe-eval debugging warning; this was not counted as a functional page error or changed here.
- Temporary server stopped after validation. No credentials were changed.

## Remaining limits

- This is a bounded audit, not a claim that every platform feature is complete. Concurrent creative, assets, lead, targeting, and spend changes were preserved and are not credited to this pass.
- Sync still does not remove local campaigns that disappear remotely. Absence from one paginated response is insufficient evidence for deletion; safe reconciliation needs a complete, generation-consistent snapshot and an explicit retention policy.
- Live OAuth consent, email delivery, Meta writes, and paid generation were not exercised. Mocked success does not establish provider readiness.
- Reporting persistence/read-error behavior was not changed in this pass; the export-formatting fix does not certify the underlying data pipeline.