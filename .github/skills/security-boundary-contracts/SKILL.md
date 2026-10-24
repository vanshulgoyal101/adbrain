---
name: security-boundary-contracts
description: "Use this skill when a feature crosses authentication, tenant ownership, URL fetching, browser automation, storage, database policy, external APIs, or privileged operations."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/security-boundary-contracts.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

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
