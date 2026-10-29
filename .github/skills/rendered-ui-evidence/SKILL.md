---
name: rendered-ui-evidence
description: "Use when changing responsive layouts, flickering scrollbars, editable fields, image framing, canvas/WebGL effects, or controls whose DOM presence does not prove usability."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/rendered-ui-evidence.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

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
- Testing a phone fix only in jsdom: it has no layout. Assert the `max-sm` rules in unit
  tests and measure `getBoundingClientRect` in a headless 390 px walk of production (#305).
- Filing a grey tile as a broken image: wait for `img.complete && naturalWidth > 0`;
  the first try was a 3.4 MB lazy load (#280).
- Testing a sticky element with one "scroll down": sweep through its own container.
  `sticky top-0` inside content also slides under a sticky app header when the page,
  not the box, scrolls (#344).
- Walking a phone flow on a stable network only: change the network once mid-stream.
  That's how a stream that never times out surfaced (#616, #666).
- Showing an action's error in a page-level banner: on a phone it's off-screen. Show it
  where the action was tapped and test inside the card's `article` (#662, #667).
- Showing a button the server will always refuse: decide eligibility at render time and
  turn the 409 into the alternative path (#662).
- Making a review that can't proceed look like one that can: use a warning colour and a
  'Fix N items' heading, not a green card missing its action (#637).
- Overlaying UI on a rendered ad's top band: the brand lockup spans its full width, so
  put chips under the picture (#367).
- An `opacity-0` placeholder on an LCP image: LCP waits for hydration even when the image
  arrived early. Check `loading`, `fetchPriority` and opacity together (#360).
- Trusting a free image provider's 'no logo' flag: check generated images by eye in the
  walk (#661).
- Making text goldens on macOS: Pango renders through CoreText there, so take goldens
  from CI, which prints the actual PNG as base64 on a mismatch (#300).
- Comparing UI gate runs from different setups: compare like with like and re-run a
  single LCP spike before believing it; it is often remote-DB noise (#417).
- Checking that an error shows without checking where: two correct blockers sat about
  3,000 px from the field they named on a phone. Measure where the message lands.
- A silently disabled primary button: keep it tappable (`aria-disabled`) and say what's
  missing beside the field. Playwright treats `aria-disabled` as disabled, so click it
  with `force` in tests.
- A streamed request without an idle timeout: a silent stream never errors, so recovery
  never runs. Found only by switching networks mid-walk.
- An awaited server action inside `startTransition` with no try/catch turns a network
  drop into the app error boundary. Test the rejected promise, not only `{ ok: false }`.
- With React 19 async transitions, state set after an await renders before `isPending`
  clears; wait for the control to be enabled, not just the text.
- Tap targets: a CSS-module rule like `.contact a { min-height }` out-ranks a utility class
  on nested links. Measure with `boundingBox` in the real page.
- Spacing around sticky elements: judge from a scrolled viewport screenshot plus
  measured gaps, not a full-page capture.
- Deleting CSS with a whole-line regex removed shared selector lists (`.safety, .faq`).
  Edit shared lists by hand and re-check every section at 390 px.
- Painting a button onto an ad image: it looks tappable but isn't. Check what the
  platform already shows next to the picture.
- 9:16 creatives: check Reels' safe zone (bottom ~35% under caption and CTA), not just
  Stories' bars; a pixel-box render test catches it for free.
- A hidden element (closed `<details>`) times out exactly like a missing one; reproduce
  the smoke step locally before changing a selector.
- A first-time-owner walk finds trust and wording problems pass/fail walks miss; run
  one after any burst of merges.

## Evidence

See [portfolio shelf and release](../incidents/portfolio-shelf-and-release.md). Shelf checks covered 1440/768/390/320px; earlier image and motion checks used their own viewport matrices. These sizes are examples, not universal requirements.

In a 2026-09-19 editor regression, native overflow changed Chromium textarea client width by 15px. Shared styling kept geometry stable, and track/thumb pixel counts persisted through 1.6 seconds of idle in Chromium and WebKit at 1440/390/320px. Keyboard scrolling and native resizing passed. WebKit's original overlay geometry was already stable; this is not proof that every platform reproduced the reported flicker.

## AdBrain lessons (Oct 28)

- Folding controls behind `<details>` breaks every "jump to the field" path. Search
  for programmatic focus (`getElementById` → `focus`) and open the fold first; a
  mutation check proves the test bites (#1155).
- For "background stops at N px" reports, check a scrolled viewport screenshot
  before changing CSS. Full-page captures don't repeat sticky elements (#1156).
- Scope e2e role queries to the main region. At 1440 the sidebar's "Review" link
  also matched `getByRole('link', {name: /review/i})` (#1152).
- Anything that lands in a visible field is owner text. Chips that call
  `reset(prompt)` fill the goal box too, so check every caller (#1153).
- When chips compete for few slots, rank short festivals above long seasons;
  calendar order alone hid Chhath behind the Diwali season (#1210).
- Showing "you pay ₹X" next to "ad budget ₹Y" reveals the margin by subtraction.
  To hide a fee, never put both amounts on the same screen (#1235).

## AdBrain lessons (Oct 28–29)

- Anything a background request produces (a success note or an error) needs a reserved
  slot near its control, not a banner above content. Test it by delaying and failing the
  request in Playwright (#1286).
- Verify CSS or deploys by reading the served chunk the page's HTML references, not the
  commit; immutable chunk URLs can be fetched from any deployment (#1346).
- Measure tap targets with the gate's own function, copied verbatim (#1287).
- Server-side SVG or sharp text needs a bundled font on Vercel; a Mac has Arial, so
  check the exported picture in production (#1375).
- Measure step pages as a logged-in first-timer, not the smoke account, which never
  sees the guided flow (#1277).
- Smoke full-screen image views mid-load as well as after; slow networks show a
  half-painted ad (#1502).
- "Never on the same screen" is enforced by rendering one tab at a time, so the other
  numbers aren't in the DOM at all (#1358).
- Find drifted empty states with a code grep for zero-data branches; most can't be
  reached with test data (#1463).
- Tailwind v4 `text-*` reads `var(--text-*--line-height)`, so one `:lang(hi)` block can
  re-tune the type scale for a script (#1503).
- Clip customer-facing copy to a sentence or clause, never a word (#1544).

## AdBrain lessons (Oct 29)

- A load failure must never reuse empty-state words: fetch failed ≠ nothing there
  (#2006). State-specific copy keys on status as well as counts (#1929), and a card
  state that reuses its badge text must not repeat it (#1841).
- Messages that can't be triggered on demand in production get gallery cards on an
  internal page so they can be walked (#1645).
- Headless Chromium's classic scrollbar shows a ~15 px strip in a 390 px screenshot;
  check `scrollWidth > innerWidth` for overflow instead of judging margins by eye
  (#1632).
- With equal specificity the later rule wins: a general `:not()` rule beat a targeted
  one. Put the targeted rule last and test the order (#1819).
- To undo a test edit on a live account, read the original from the database, type it
  back and confirm with a read; autosave may ignore a cleared field (#1966). Read-only
  walks only reach the empty path; seed a labelled row with approval and delete it
  through the app's own undo (#1702).
- Pin translated strings exactly in an i18n test; Hindi honorific agreement (आप … हैं)
  needs checking on every new line (#1945).
