# Worker 3: Contextual Connection Experience

Read [coordination](README.md), [contracts](CONTRACTS.md), and parent sections
1, 3-5, 7-9, 11-12 of [the plan](../META-INSTANT-CONNECT-PLAN.md).
Own React UI, safe browser transport, page wiring and browser regression evidence.
Do not implement OAuth token exchange, business authorization, RLS or campaign API.

## Before editing

1. Read AGENTS.md and relevant installed Next docs for server/client components,
   route pages and async APIs. Read existing connection/campaign components,
   page props, dialog pattern, shared primitives and nearby tests.
2. Record baseline, owned component test names, and intended files in HANDOFF-3.
3. Start with contract fixtures, not dependency waiting. First regression: returning
   a connected fixture for an activation intent must render review without any
   create/activate request. Wire the smallest testable dialog/consumer change.

## Ordered tasks

### W3-01: Client and contract fixtures

- Implement same-origin fetch transport with Zod response validation, typed safe
  errors, AbortSignal, no-store status reads and injectable fetch for tests only.
- Initial fixtures cover every contract truth-table row; replace provisional test
  types with Worker 1/2 exports at C0. Never put token fields in fixtures or props.
- Client must not manufacture readiness, select a Page by name, decide permissions,
  or parse raw Graph errors. Those are Worker 1 decisions surfaced through DTOs.
- Before backend readiness, keep live entrypoints gated; no successful fake API
  fallback or hardcoded customer business/account.

### W3-02: Shared connection dialog

- Implement native modal using existing accessible patterns: focus trap, Escape,
  return focus, visible focus, dialog name, live progress/error region.
- Render disconnected, authorizing, discovering, selection, action-required,
  reconnect, cancelled/expired/failed and connected states. Clear single action
  for the current task; no nested cards or mini settings dashboard.
- Candidates use accessible radio selection plus account/Page labels, portfolio
  context, currency and blockers. Disable ineligible pairs; require explicit
  replacement confirmation when the server says the previous pair changed.
- Connected summary includes actual selected identity, Change and operation-specific
  readiness. Billing needed is not a total connection failure.
- Keep DM Sans, existing restrained colors/shared primitives/Lucide icons. No
  marketing hero, generated decorative assets, global restyle or icon pipeline edits.
- No App ID/secret/token fields, raw IDs as main labels, fake progress percentages,
  internal traffic runner or permission configuration controls in customer setup.

### W3-03: Popup, polling and redirect completion

- Synchronously open same-origin waiting popup in click handler, then POST start.
  If POST fails close only the popup you created and show safe recovery.
- If popup blocked use the returned same-tab authorization URL after draft save.
  Never ask browser code to compose OAuth scopes/state/redirect_uri itself.
- Poll attempt endpoint with bounded backoff and server retry hint. Abort on close,
  business switch, new attempt or unmount; ignore out-of-order stale responses.
- Window closure is not proof of cancellation. Query server before final outcome;
  pending work remains recoverable. No popup.closed-only terminal decision under COOP.
- Exact origin, popup identity and attempt ID checks for message hint. Refetch after
  valid hint; a message payload never marks connected. No wildcard postMessage target.
- Completion page validates the owned attempt via Worker 1 accessor before exposing
  intent/status. Display clear continuation if opener missing; no arbitrary URL.
- Session expiration goes through existing sign-in with safe resume reference.
  Client stores no token/code/state. Full-page OAuth must not lose saved draft.
- Test real applicable headers with coordinator; do not edit global CSP/COOP.

### W3-04: Setup and Settings integration

- Signed-in saved business gets prominent Connect Business and optional draft-first
  path. Use the explicit page/business context, never infer from account name.
- Do not add Meta-as-AdBrain-login, merge accounts, or change Google/email auth.
- Reuse dialog in Settings; show safe connected summary, Change/Reconnect/Disconnect.
  Disconnect warns it does not pause ads and requires a separate explicit pause
  action through existing APIs when requested. Do not promise provider-wide revocation.
- If missing business prevents connection, point to current business setup; don't
  secretly create an empty business from a client-supplied owner ID.
- Brand-save action is not yours: use existing returned business identity/page
  context. If it lacks required data, request a coordinator-owned adapter change.

### W3-05: Campaign draft and review integration

- Manual/guided composers remain mounted or persist equivalent draft state. Save
  goal, creative IDs, form, budget, targeting and mode using Worker 2 DraftDTO API
  before OAuth navigation. Version conflict preserves local edits and asks to reload
  or explicitly resolve; never overwrites newer work silently.
- First Prepare triggers preflight; missing connection opens modal in place. On
  connection completion refetch preflight and show review, not create automatically.
- Guided planning consumes plan-only DraftDTO, displays plan summary, then follows
  same preflight/create path. Do not preserve old API assumptions by adding a UI bypass.
- Review displays account/Page, currency, geographic area, approved creative choices,
  per-set and effective total budget. Blocks are actionable, unknowns not hidden.
- Explicit Create paused uses a stable idempotency key for the same reviewed attempt.
  Disable duplicate clicks, show persisted operation status; timeout queries operation
  instead of generating a new key and resubmitting. Payload edit requires a new review.
- Activation always has a new confirmation of total spend and current binding using
  Worker 2 schema; OAuth return does not retain an already-approved activation action.
- needs_reconciliation is not a retry-create button. Show known status and safe
  recovery. Page reload fetches operation/draft rather than losing the outcome.

### W3-06: Guided external setup and states

- Missing portfolio/account/Page, billing, verification and admin access each show
  the server's specific recovery action, with Check again after returning from Meta.
- Validate external URL via contract and safe link attributes. Do not invent links
  or embed payment forms. Link click does not mark a blocker resolved.
- v1 exposes no enabled automated provisioning control. Optional prototype state can
  be test-only; no promise that every business qualifies for account creation.
- Empty/error/offline/expired/unsupported-currency states preserve the draft and
  never hide an error behind a permanent spinner. Allow retry only where safe.

### W3-07: Browser evidence and handoff

- Component tests plus standalone Playwright script in owned path. No config or
  package changes without coordinator approval; reuse installed dependencies.
- Browser fixtures intercept all non-read business actions, including paid creative
  generation, Meta account/campaign mutations and AI planning. Fail unexpected
  requests. Do not run a live campaign to prove the UI works.
- Verify 1440, 1024, 768 and 390 widths, no overflow/overlap, long asset names,
  keyboard focus/escape, reduced motion, dialog close/reopen, draft resumption.
- Capture and inspect screenshots in worker-specific ignored test-results folder;
  keep customer data/private output out of committed public docs. Existing suites
  may clear test-results, so record evidence before another run removes it.
- Use browser/server for your checkout only. Reuse a healthy appropriate dev server
  or coordinator-assigned port. Stop only servers you started.

## Required tests

| Test ID | Scenario | Must assert |
| --- | --- | --- |
| W3-T01 | Connected event after activation intent | Review shown, zero activation/create requests |
| W3-T02 | Popup blocked | Saved draft then same-tab navigation; no lost goal |
| W3-T03 | Wrong-origin/source/attempt message | Ignored; no status change |
| W3-T04 | Business switch during fetch | Old result ignored; no cross-business labels/actions |
| W3-T05 | Multiple/ineligible/partial candidates | Explicit eligible choice; no client auto-selection |
| W3-T06 | Connected with billing/unknown capabilities | Accurate action-specific blocks |
| W3-T07 | Double create click, timeout, reconciliation | One key; status read; no blind retry |
| W3-T08 | Keyboard/Escape/mobile long labels | Correct focus and no overflow/overlap |
| W3-T09 | Reload/no opener/session expiry | Owned intent resumes review safely |
| W3-T10 | Backend unavailable/malformed response | Safe error; no fixture fallback |

HANDOFF-3 includes exact component exports, screenshots checked, commands/results,
real versus mocked flows, missing backend integration and no-production-action
statement. Do not call visual fixture success a real Meta authorization test.