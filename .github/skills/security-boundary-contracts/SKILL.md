---
name: security-boundary-contracts
description: "Use this skill when a feature crosses authentication, tenant ownership, URL fetching, browser automation, storage, database policy, external APIs, or privileged operations."
---

<!-- Generated from vanshulgoyal101/skills@7a64868 skills/security-boundary-contracts.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Security Boundary Contracts

## Trigger

Use this skill when a feature crosses authentication, tenant ownership, URL fetching, browser automation, storage, database policy, external APIs, or privileged operations.

## Invariant

Every boundary has one explicit owner for authorization, validation, scope, and failure behavior; downstream code cannot accidentally widen access by trusting a weaker representation.

## Failure pattern

A route checks that a user is signed in but not that they own the target business; a fetcher validates only the first URL form or redirect; a browser tool runs arbitrary code against an untrusted origin; or a database policy and application assumption disagree. The feature appears functional while its trust boundary is porous.

## Recommended method

- Identify the trust boundary before implementing the happy path.
- Normalize inputs in the same form used by the runtime: URLs, IPs, paths, IDs, account scopes, and browser origins.
- Authorize at the narrowest resource boundary and re-check ownership after lookup.
- Validate every redirect, retry, storage restore, and external response that can cross the boundary.
- Return safe, bounded errors and avoid exposing secrets or untrusted content as instructions.
- Add tests for alternate representations, wrong tenants, missing auth, redirects, stale state, and malformed input.
- Walk the route tree on disk and assert every privileged endpoint rejects anonymous callers before doing work; `/internal/` in a URL is organization, not authorization.

## Discriminating checks

- Can an authenticated user access another tenant's resource by changing an ID or slug?
- Does validation cover alternate syntax and every redirect/retry hop?
- Does the same normalized value reach the database, socket, browser, or filesystem runtime?
- Do missing credentials fail closed without leaking secrets?
- Does a browser or external-content path distinguish trusted local content from arbitrary remote code?

## Common traps

- Authentication-only guards for resource-scoped operations.
- Returning resource-specific status (for example a reconciliation 409) before
  the ownership check runs. Authorize first, then inspect stored detail.
- Regex-only SSRF or path checks.
- Validating the initial request but not redirects or retries.
- Trusting TypeScript types after JSON, storage, or network input.
- Turning user-controlled external content into executable instructions.
- Assuming an internal-looking route prefix is an auth boundary.

## Evidence

The ctx/MCP SSRF incidents, vbrain JSON-LD boundary work, AdBrain tenant and Meta routes, and the browser approval investigations all required runtime-aligned trust boundaries rather than surface checks.

## AdBrain lessons (Oct 29)

- A signed upload URL accepts any bytes, so browser re-encoding doesn't guarantee
  metadata (EXIF) removal; strip it server-side at finalize (#2001).
- An injection red test over the final validators found 8 gaps in one pass; write it
  before the audit fix (#1889).
- Public repo hygiene: grep a body for 15+ digit ids before posting and use opaque
  keys; strip whole id lists, since 10-digit comment ids look like phone numbers to a
  scanner; an API edit leaves the old value in the comment's edit history, so check the
  scanner's allowlist before redacting (#1605, #2151, #2126).
- After every env change, run a read-only secrets sweep that prints paths and file
  modes, never values; encrypt exports when they are written, not later (#1834).

## AdBrain lessons (Nov 1–3)

- What Review showed is what executes. Put every reviewed choice in the Review DTO and
  the hashed launch payload, and launch from that value; never re-derive it. A CTA was
  stored and shown but never sent (#2600, #2599). Gates belong in the shared server
  service plus the route: a UI-only gate left launch and the worker open, and new goal
  fields without a server Review refusal would have launched the old objective
  (#2688, #2710). A provenance gate must call the same helper the UI labels from, or
  one receipt shape slips through (#2657).
- `req.json().catch(() => ({}))` turns a garbled body into defaults that start work.
  Read the text, treat only empty as `{}`, and return 400 on a parse failure. Red test:
  a truncated body gets 400 with zero service calls (#2739).
- Ship an auth hardening (CAPTCHA) off by default with a byte-identical disabled path,
  and smoke the off state (page and CSP) before any key exists (#2570).
- Size a per-owner limit on a polled read for every poller that can run at once
  (tabs × components), from the peak 5-minute request count, not for one (#2553).
- An allowlisting schema strips unknown fields silently: add a new event attribute to
  the schema in the same PR; metrics on it count only rows written after the deploy
  (#2499).
- Public-data scanners: ids from a growing counter drift into another pattern's range
  (comment ids passed 6e9 and matched a mobile-number shape), so exempt a number by
  asking its source, not by digit shape (#2727). After a scanner fix, re-run
  `--dry-run` over the open report's window before redacting (#2729), and verify a
  dispatched full-history scan at the exact containing SHA (#2633). Redaction must cover
  command output too: route read-backs through a pure formatter with a test (#2713).
