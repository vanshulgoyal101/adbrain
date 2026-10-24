---
name: rendered-ui-evidence
description: "Use when changing responsive layouts, flickering scrollbars, editable fields, image framing, canvas/WebGL effects, or controls whose DOM presence does not prove usability."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/rendered-ui-evidence.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Rendered UI Evidence

## Trigger

Use when changing responsive layouts, flickering scrollbars, editable fields, image framing, canvas/WebGL effects, or controls whose DOM presence does not prove usability.

## Invariant

The rendered surface fits its intended viewport, exposes actionable controls, and shows the intended media or effect. Evidence names the state and rendering conditions actually checked.

## Failure pattern

A disclosure is CSS-visible but opens below the viewport. An image loads but crops the subject. A canvas exists but is blank. Global control sizing distorts a switch. Large or frequent pixel readbacks slow the very animation the test is measuring.

## Recommended method

- Test the real user journey and capture its important states, not just isolated component markup.
- Distinguish visibility from viewport intersection, occlusion, and actionability. Require full viewport intersection for a control that must be entirely reachable without another scroll.
- Measure text and control bounds at desktop, tablet, and the narrowest supported width. Check long titles, wrapped labels, internal overflow, and document overflow.
- Reserve stable image geometry using an aspect-ratio frame. Verify image/frame rectangles, natural image dimensions, and the visible subject. Choose crop position from the actual asset; no universal object-fit choice preserves every subject.
- For canvas/WebGL, wait for meaningful pixels, check occupied bounds, compare later frames, exercise interaction, and verify off-screen pause or final clearing where required.
- Scope pixel capture to the target. Stop expensive full-canvas readbacks once sufficient evidence exists; use backend-aware bounded waits without weakening the behavior assertion.
- Floating targets may never satisfy locator stability. For tests of intentionally moving controls, click a freshly measured position and assert the resulting event/state sequence.
- Inspect screenshots manually. Captures without a baseline comparison are evidence, not pixel regression tests.
- Block external dependencies only when appropriate, and explicitly state which live services and remote links were not exercised.
- For real login checks, capture any required response body before navigation
	discards it. With Playwright routing, fetch the actual upstream response, read
	the session in memory, then fulfill with that same response. Disable retries
	for the login request and never persist or log credentials or tokens. A
	navigation-related body-read failure is not evidence of an authentication outage.
- Wait for the specific image's load completion and nonzero natural dimensions
	before capturing a lazy-loaded page. An early placeholder capture is not proof
	that the stored asset is broken.
- Record `document.visibilityState` and measured `innerWidth`/`innerHeight` for
	deployed checks. A hidden embedded session may not expose streamed content as
	expected; a requested resize may differ from the actual viewport. Foreground and
	check once before calling the route globally broken; do not loop hidden reloads.
- Establish network/mutation guards before navigation where feasible. A page can
	automatically sync on mount or foreground even when the tester never clicks Sync.
	A late guard cannot prove earlier side effects were absent.
- Playwright's `page.route` cannot stream a response. Drive an NDJSON UI with an
	`addInitScript` fetch wrapper that the test feeds line by line (#141).
- Log each image with the page that loaded it. Grey cards came from three screens
	loading ~2 MB originals; show thumbnails everywhere, original as fallback (#158).
- A desktop-sized nested scroll box hid stacked mobile cards. Cap it only where the
	cards sit side by side; scroll new results to their heading, not the bottom (#169).

### Focus, identity and truthful interaction

- Inspect visible paint, not CSS numbers alone: a nonzero outline width with
	`outline-style: none` paints nothing. A keyboard-focused button at opacity zero
	is not usable merely because it has an accessible name or receives focus.
- In an input-plus-action group, Tab through both. The wrapper may paint an input
	ring while a Clear button needs its own ring; avoid competing nested outlines
	without removing the indication from the actionable child. Text fields can
	match `:focus-visible` after pointer focus, so test both input modalities.
- Duplicate titles/statuses need distinct useful accessible identities. Test that
	pointer/keyboard selection reaches the intended saved record after filtering
	and reordering, without exposing raw private IDs just to make labels unique.
- Unsaved close/reopen checks exercise local state, not server persistence. Empty
	lists cannot demonstrate real row selection or follow-up; mocked saves cannot
	establish an authenticated save. State exactly which interactions occurred.

## Discriminating checks

### Scrollbars and editable fields

- Identify the actual scrolling element. Styling conversation history does not fix an independently scrolling textarea. Put shared field behavior in the primitive and migrate raw fields that bypass it; preserve native props, refs, constraints and explicit overrides.
- Separate stable geometry from visible paint. A reserved gutter can prevent width changes without preventing an overlay thumb from fading. Where a persistent track is required, use explicit vertical overflow and supported scrollbar styling; verify the result in each target engine rather than assuming CSS support.
- Preserve native keyboard scrolling and vertical resizing. Constrain field width so resize gestures cannot widen the page; do not hide scrollbars or introduce auto-height loops as an unmeasured workaround.
- Cross the overflow threshold repeatedly with short, exact-row and longer content. Compare client width/height, then inspect track/thumb pixels before and after idle. Enable scrollbar painting in headless browsers that hide it by default, and report that launch condition.
- Exercise actual caret movement and drag resizing at desktop and narrow widths. Assert the fixture really overflows before testing scroll ownership, and allow native scroll events to run before releasing a delayed response.
- For credential-free component checks, bundle the real component and application CSS, stub server actions to fail on unexpected writes, and fulfill or block every network request. Keep the harness in the repository with direct test dependencies. This proves component behavior, not authenticated integration or real-device Safari behavior.

### Other rendered surfaces

- Open a footer disclosure with pointer and keyboard; verify its controls are fully in view and focus is retained.
- Sample a scene for nonblank pixels, containment, motion, drag response, and final cleanup across supported viewports.
- Confirm reduced-motion and unsupported-device visits do not load excluded expensive modules.
- Test image geometry before and after hover and inspect every distinct asset crop.
- Preserve failure screenshots and traces; serial reruns can reveal timing sensitivity but do not establish its cause.

## Common traps

- Equating `toBeVisible` with being on-screen, unobscured, or usable.
- Trusting `toBeInViewport()` alone. It passed a heading hidden under a sticky bar;
  only a real 390 px walk caught it. Check `elementFromPoint` at its centre (#169).
- Counting a mounted canvas as successful rendering.
- Measuring only document overflow when a nested element clips its contents.
- Calling screenshots golden baselines when no comparison occurs.
- Claiming a device/backend path is covered because another path passed.
- Driving several agent tabs in one shared browser. Only one tab is visible;
  background tabs report `visibilityState: hidden`, pause animation frames and can
  sit on a loading shell. Use a headless scripted session per check instead.

- Light-only UI on a phone in dark mode: with no dark styles, Chrome auto-dark or an
  iOS extension repaints it unevenly (dark page, invisible inputs, muddy cards). Declare
  `color-scheme: only light` (meta + CSS) unless you ship a real dark theme.

## Evidence

See [portfolio shelf and release](../incidents/portfolio-shelf-and-release.md). Shelf checks covered 1440/768/390/320px; earlier image and motion checks used their own viewport matrices. These sizes are examples, not universal requirements.

In a 2026-09-19 editor regression, native overflow changed Chromium textarea client width by 15px. Shared styling kept geometry stable, and track/thumb pixel counts persisted through 1.6 seconds of idle in Chromium and WebKit at 1440/390/320px. Keyboard scrolling and native resizing passed. WebKit's original overlay geometry was already stable; this is not proof that every platform reproduced the reported flicker.
