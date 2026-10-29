# Boundaries

Part of [Team](README.md). CI jobs and commands: [Testing](testing.md).

The `boundaries` check keeps the code split the way
[ADR-001](../architecture/adr-001-multi-channel.md) plans: UI talks to services,
services talk to channel adapters through one registry, adapters stay apart, and
money stays out of adapters. Known violations are listed in
[`scripts/boundaries-baseline.json`](../../scripts/boundaries-baseline.json). That
list may only shrink.

## Running it

| Where | Command |
| --- | --- |
| Local | `npm run boundaries` (runs [`scripts/check-boundaries.mjs`](../../scripts/check-boundaries.mjs)) |
| Local, like CI on a PR | `npm run boundaries -- --base origin/next` |
| CI | job `boundaries` in [`ci.yml`](../../.github/workflows/ci.yml): `npm run boundaries -- --base origin/<base>` on PRs, plain `npm run boundaries` on pushes |

`boundaries` is not a required check yet. The required checks on `next` are `build`, `test`,
`core`, `secrets` and `core-approval`.

The check fails when:

- a violation is not in the baseline (a new edge);
- a baseline entry no longer occurs (you fixed it; drop it from the baseline);
- with `--base`, the baseline has an entry the base branch did not have, or a higher C4 line count;
- a file listed under C4 has more lines than its baseline ceiling.

## What each rule protects

Import rules, from [`.dependency-cruiser.mjs`](../../.dependency-cruiser.mjs). UI means
`src/app/` and `src/components/`. Test files are excluded.

| Rule | Protects |
| --- | --- |
| `R1-ui-no-channels` | UI never imports `src/channels/` or `src/lib/meta/` (except the Meta type files). |
| `R1-ui-meta-types-only` | UI may import `src/lib/meta/types.ts`, `contracts.ts` and `connect-contracts.ts` only as `import type`. |
| `R2-client-no-server` | A `"use client"` file never value-imports `src/lib/supabase/admin`, `src/lib/meta/`, `src/lib/payments/`, `src/lib/llm/` or `crypto`, so server code and secrets don't ship to the browser. |
| `R3-domain-no-app-imports` | `src/domain/` imports only `src/domain/`. |
| `R3-domain-npm-only-zod` | `src/domain/` uses no npm package except `zod`. |
| `R3-domain-no-io` | `src/domain/` does no I/O (`fs`, `net`, `http`, `https`, `http2`, `child_process`, `dgram`, `tls`). |
| `R4-services-via-registry` | `src/services/` reaches adapters only through `src/channels/registry`. |
| `R5-channel-isolation` | One adapter in `src/channels/<name>/` never imports another adapter. |
| `R6-money-not-in-adapters` | `src/channels/` and `src/lib/meta/` never import `src/lib/payments`, `src/lib/plan` or `src/lib/managed/spend-cap`. Money decisions live in services. |

Source checks, from `checkFile` in [`scripts/check-boundaries.mjs`](../../scripts/check-boundaries.mjs):

| Rule | Protects |
| --- | --- |
| `C1-graph-urls-in-meta` | Only `src/channels/meta/`, `src/lib/meta/` and `src/lib/security/headers.ts` mention `graph.facebook.com`, `${GRAPH}` or `GRAPH +`. |
| `C2-adapter-own-data` | An adapter (`src/channels/<name>/`, `src/lib/meta/`) touches only its own tables and RPCs. For Meta: `meta_connections`, `managed_meta_accounts`, `managed_meta_account_events`, `whatsapp_number_bindings`, and RPCs starting `meta_` or `managed_meta_account_`. |
| `C3-appsecret-proof` | A file that builds a Graph URL also sends `appsecret_proof` (`appSecretProof` or `appsecret_proof` appears in it). `graph-version.ts` and `headers.ts` are exempt. |
| `C4-file-size` | No source file goes over 400 lines. Files already over it are listed with a `lines` ceiling and may only shrink. |

## Fixing a red check

The CI summary lists each failing entry as `rule: from → to`. Fix the code, not the baseline.

| Rule | Fix |
| --- | --- |
| `R1-ui-no-channels` | Import through a module in `src/services/`. Example: [`src/services/business-access.ts`](../../src/services/business-access.ts) re-exports the ownership check so the results-card route no longer imports `src/lib/meta/` (#2165, PR #2169). Add a similar service file if none fits. |
| `R1-ui-meta-types-only` | Change the import to `import type`. If you need a value, get it through a service. |
| `R2-client-no-server` | Move the server work into a route, server action or server component, and pass the result to the client file. Use `import type` for types only. |
| `R3-*` | Keep `src/domain/` pure: pass data in as arguments, do I/O in a service, and use only `zod` from npm. |
| `R4-services-via-registry` | Get the adapter from `src/channels/registry` instead of importing `src/channels/<name>/` directly. |
| `R5-channel-isolation` | Move the shared code to `src/domain/` (pure) or a service, and import it from both adapters. |
| `R6-money-not-in-adapters` | Make the money decision (payment, plan, spend cap) in the service and pass the result to the adapter. |
| `C1-graph-urls-in-meta` | Call the Meta adapter (through a service) instead of building a Graph URL outside it. |
| `C2-adapter-own-data` | Read or write that table or RPC in a service, and pass the data to the adapter. |
| `C3-appsecret-proof` | Add `appsecret_proof` to the Graph call, the way the existing Meta helpers do. |
| `C4-file-size` | Move your own new lines into a sibling module (400 lines or fewer), so the file stays at or under its ceiling. The author fixes it. The baseline never goes up (#2071). |

When you fix an entry, the check goes red with "Fixed, still in the baseline". Run
`npm run boundaries -- --write-baseline`, check the diff (below) and commit the
smaller baseline.

### Red on a file your PR didn't touch

That is inherited drift: something already merged grew it. Don't raise the baseline
in your PR. Find the PR that grew the file (`git log` on the file) and name it on
#1792, so its author fixes it.

## The `--write-baseline` trap

`--write-baseline` does not only remove fixed entries. It overwrites
`scripts/boundaries-baseline.json` with whatever the code has now: new violations are
added and every C4 `lines` ceiling is set to today's count, including files that grew.
It always exits green.

So after every `--write-baseline`:

```bash
git diff scripts/boundaries-baseline.json
```

Keep only removed entries and lower `lines` numbers. Revert any added entry or raised
`lines`, then fix the code instead. In CI, `--base` catches a grown baseline, but check
it yourself first.

## Hotfixes and the main → `next` sync

CI runs `boundaries` on PRs to `main` too, against the same baseline, but it is not
required, so a hotfix can merge while it is red (#1789 did). Its growth then reaches
`next` through the main → `next` sync and turns every later PR red (#2157, #2165; see
#2070). Hotfix authors: get `boundaries` green on the hotfix PR itself, or run
`npm run boundaries -- --base origin/main` before merging.
