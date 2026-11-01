---
name: hydration-determinism
description: "Use this when server-rendered or statically rendered UI also renders on the client and output depends on time, timezone, locale, randomness, browser state, or per-request data."
---

<!-- Generated from vanshulgoyal101/skills@77e6db7 skills/hydration-determinism.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Hydration Determinism

## Trigger

Use this when server-rendered or statically rendered UI also renders on the client and output depends on time, timezone, locale, randomness, browser state, or per-request data.

## Invariant

The first client render is identical to the server HTML. Nondeterministic values are either pinned to a deterministic input or deferred until after mount.

## Failure pattern

`new Date()`, timezone-derived labels, `Math.random()`, or browser-only state runs during render. Server and client disagree, causing hydration warnings, subtree replacement, visible flicker, or stale navigation when combined with router caching.

## Recommended method

- Pin locale and timezone for shared formatting.
- Pass server-derived values as props when the server owns the value.
- Gate browser-only values behind a mounted-state hook.
- Keep live per-user data out of static render output; configure dynamic caching deliberately.
- Add a boundary regression test around date/day transitions.

## Discriminating checks

- Render with a UTC server clock and an IST client clock near midnight; assert identical initial output.
- Assert the mounted hook is false during `renderToString`.
- Run a production navigation test and confirm current data is not served from an unintended stale RSC cache.

## Common traps

- Fixing a hydration warning with a blanket `suppressHydrationWarning`.
- Calling `toLocaleDateString()` without a pinned timezone.
- Reading `window`, localStorage, or image completeness during the first render.
- Assuming a successful local client render proves SSR parity.

## Evidence

AdBrain fixed seasonal/date hydration and cached-image flicker with deterministic IST formatting and mounted-state guards in `cee48bc`, `e91129c`, and `c94b482`.

## AdBrain lessons (Oct 28)

- Date tests passed only because the Mac runs in IST; run focused tests with `TZ=UTC`
  to match CI (#1290).
- A value (not a component) exported from a "use client" module is a client reference
  in server code: unit tests pass and the page crashes. Keep shared constants in a
  plain module and render the page once before merging (#1272).
- One `await getUser()` in a public page makes the route dynamic (no CDN, a round trip
  per visit). Do per-user redirects in the proxy (#1376).
- When a click handler gains an await, set any state another callback reads before the
  await (#1333).

## AdBrain lesson (Oct 29)

- Mark the language on the Hindi words (`lang`, WCAG 3.1.2), not on `<html>` from a
  cookie: a cookie read in the root layout makes every static page dynamic (#1895).
