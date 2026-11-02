# Multi-Channel Architecture (ADR-001, #1792)

Part of [Architecture decisions](README.md#decisions-adrs).

**Status:** accepted (CEO, Oct 29; #1805). The Reviewer's eight conditions are incorporated below.

### Context

AdBrain will add Google, TikTok, X and other ad channels. Today Meta reaches almost everywhere:
121 files outside `src/lib/meta` import it (53 in `src/app`, 51 in `src/lib`, 17 components, 14 scripts),
`src/lib/campaign` (68 files) speaks in ad sets and Meta statuses, and the database keys campaigns, ads,
results and leads on `meta_*` ids. A second channel today would mean copying the launch, manage, results
and leads paths. Nothing enforces module boundaries in CI (ESLint has no import rules).

### Decision

1. **Channel-neutral domain.** Business, Brand, Creative, MediaAsset (owner uploads and consents, #744), Campaign
   (goal, budget, cap, schedule, audience intent), Lead, Result and Connection are plain types and rules with no I/O and no channel words.
2. **One adapter per channel** behind `ChannelAdapter`. Meta is adapter #1. A channel's object tree (Meta's
   campaign → ad set → ad), ids, statuses and error codes stay inside its adapter; the domain holds only
   opaque `ExternalRef`s.
3. **Services orchestrate** (launch, manage, results, leads, connect). They read and write the database and
   call adapters only through the registry. Routes and components call services, never channels.
4. **Boundaries are enforced in CI** with a baseline that can only shrink (Phase 1).
5. **The data model grows additively:** `channel` plus external identity columns. Nothing is dropped or
   renamed (#1173); Meta columns stay until no code reads them.
6. **Strangler migration, not a rewrite:** each slice moves one path behind the adapter with behaviour
   unchanged, proven by the existing recorded core tests.

### Folder layout

| Folder | Holds | May import |
| --- | --- | --- |
| `src/domain/` | Types and pure rules (`campaign.ts`, `results.ts`, `leads.ts`, `channel.ts` with the adapter interface) | Nothing app-specific (zod, std only) |
| `src/channels/<name>/` | Adapter, transport, mapping to and from domain types, channel-only stores (e.g. `meta/tokens`, `meta/managed`) | `domain`, `lib/security`, `lib/observability`, `lib/supabase` for the channel's **own private tables only** (tokens, attempts); never `public.*` business tables, which go through services and RLS |
| `src/channels/registry.ts` | `adapterFor(channel)`, the only place that names concrete adapters | `channels/*` |
| `src/services/` | Orchestration with DB access: `launch`, `manage`, `results`, `leads`, `connect` | `domain`, `channels/registry`, `lib/*` |
| `src/app/`, `src/components/` | Routes and UI (unchanged locations; components split by feature in Phase 4) | `services`, `domain`, `lib/*`; **never** `channels/*` |
| `src/lib/` | Shared infrastructure (supabase, llm, imageGen, security, observability, payments). Loose files move into domain folders as they're touched | as today |

Existing code moves only when its slice is migrated: `src/lib/meta` → `src/channels/meta`, the Meta-shaped
parts of `src/lib/campaign` → `channels/meta`, the channel-neutral parts → `domain` or `services`.

### The adapter interface (sketch)

```ts
// src/domain/channel.ts
export type Channel = "meta" | "google" | "tiktok" | "x";
export type ExternalRef = { channel: Channel; kind: string; id: string }; // opaque outside the adapter

export interface CapMechanism {                  // how a channel can bound total spend (#2048)
  kind: "campaign_cap" | "lifetime_budget" | "total_budget";
  guarantee: "native" | "service_enforced";      // native: the provider stops delivery; else our watchdog does
  minMinor: Record<string, number>;              // per currency, e.g. Meta campaign_cap ≥ ₹5,000
  requiresEndTime: boolean;
}

export interface ChannelCapabilities {
  objectives: ("enquiries" | "chats" | "calls" | "traffic")[];
  formats: ("image_4x5" | "image_1x1" | "story_9x16" | "video")[];
  leadForms: boolean; messaging: boolean;
  capMechanisms: CapMechanism[];                 // empty → the service refuses activation
  audienceEditInPlace: boolean; // false → edits need a copy-and-switch (Meta today)
  minDailyBudgetMinor: Record<string, number>; // per currency
}

export interface ChannelContext {               // reads
  businessId: string; connection: ConnectionBinding; signal?: AbortSignal;
}
export interface WriteContext extends ChannelContext { // every write method takes this; the registry refuses one without
  connection: ConnectionBinding & { generation: number; account: string }; // bound account + generation, required
  idempotencyKey: string;                              // persisted by the service *before* the call
  writeMode: "full" | "pause_only";
}

export type WriteOutcome<T> =
  | { status: "done"; value: T }
  | { status: "uncertain"; refs: ExternalRef[] }; // → needs_reconciliation, never auto-replayed

export interface ResultSnapshot {                // #2050; the card renders this with no channel branch
  ref: ExternalRef; period: Period; timezone: string; currency: string;
  dateBasis: "interaction" | "conversion" | "reported";
  spendMinor: number; impressions: number;
  clicks: number; clickKind: "link" | "all";   // Meta link clicks, Google all clicks
  results: { value: number; resultType: string }[]; // value may be fractional (Google conversions)
  unsupported: { field: string; reason: string }[]; // unsupported is never 0
  complete: boolean;                             // false → missing rows are not zeros
}

export interface ChannelAdapter {
  readonly channel: Channel;
  capabilities(ctx: ChannelContext): Promise<ChannelCapabilities>;
  connect: ConnectFlow;                                   // OAuth/discovery/selection; channel-specific steps behind one flow
  validate(ctx: ChannelContext, plan: LaunchPlan): Promise<Validation>; // dry run only
  launch(ctx: WriteContext, plan: LaunchPlan): Promise<WriteOutcome<LaunchedCampaign>>; // always paused
  activate(ctx: WriteContext, ref: ExternalRef, cap: SpendCap): Promise<WriteOutcome<void>>;
  pause(ctx: WriteContext, ref: ExternalRef, scope?: "campaign" | "ad"): Promise<WriteOutcome<void>>;
  editBudget(ctx: WriteContext, ref: ExternalRef, budget: Budget): Promise<WriteOutcome<void>>;
  editAudience(ctx: WriteContext, ref: ExternalRef, audience: AudienceIntent): Promise<WriteOutcome<AudienceEdit>>;
  editCreative(ctx: WriteContext, ref: ExternalRef, creative: CreativeVersion): Promise<WriteOutcome<void>>;
  syncStatus(ctx: ChannelContext, refs: ExternalRef[]): Promise<CampaignState[]>;
  fetchResults(ctx: ChannelContext, ref: ExternalRef, period: Period): Promise<ResultSnapshot>;
  syncLeads(ctx: ChannelContext, cursor?: string): Promise<LeadPage>;
  enforceSpendCap(ctx: WriteContext, ref: ExternalRef, cap: SpendCap): Promise<WriteOutcome<void>>;
  cleanup(ctx: WriteContext, refs: ExternalRef[]): Promise<WriteOutcome<void>>;
  revoke(ctx: WriteContext): Promise<void>; // best effort, never blocks disconnect (#1649)
}
```

Every write method above takes a `WriteContext` (the `ctx` of `launch`, `activate`, `pause`, `editBudget`,
`editAudience`, `editCreative`, `enforceSpendCap`, `cleanup`, `revoke`).

**Contracts every adapter must pass** (a shared contract test suite, Meta's recorded tapes first):
- **Capped activation:** `validate` picks one `capMechanism` for the plan's amount (Meta today: `campaign_cap`,
  native, from ₹5,000; below that `lifetime_budget`, service-enforced; Google `total_budget`, native, only once a
  `validate_only` create succeeds for that campaign type and bid strategy). `activate` writes the cap, **reads it
  back** (cap, end time, no uncapped daily budget), and only then turns delivery on; any other path returns
  `uncertain`. A `service_enforced` mechanism activates only once `enforceSpendCap` is scheduled for the ref.
  **There is never a fallback to a daily or uncapped budget:** if no mechanism validates, the service refuses
  activation, never substitutes.
- **Idempotency:** neither provider honours an idempotency key, so the service guarantees it. The key is
  persisted before transport, with one in-flight write per key and connection generation. A transport-ambiguous
  create returns `uncertain`; reconciliation looks for an object carrying the key's marker. Exactly one match is
  adopted; zero or several stay `uncertain` and are never re-created automatically (zero matches does not prove
  the create failed).
- **Partial failure:** Google launch objects go in one `GoogleAdsService.Mutate` with `partial_failure=false`
  (all or nothing). Meta has no transaction: every `launch` step is PAUSED and `cleanup` removes partial trees.
- **Schedules** are in the provider account's timezone, stored with the ref. UI duration minimums are not
  validation rules; the `validate_only` call decides.
- **Results:** `result_type` comes only from an explicit per-action mapping in the adapter (raw Google
  `conversions` stays `google_conversion` until a mapped action says otherwise). Money converts to minor units
  inside the adapter (Google `cost_micros` via the ISO 4217 exponent, aggregated before one documented rounding).
- **Generation:** a write whose generation no longer matches the stored connection is refused before transport.
- **Disconnect:** `revoke` revokes the grant at the provider (best effort); the service then purges the
  credential (deleted, not only marked revoked: #1648, #1734).

**Tenancy:** the business always comes from the service's context, never from channel data. `syncLeads` and
`fetchResults` return external refs; the service maps each ref to a business through its **own** stored refs
and drops anything unmatched (#1775's bug: one Page's leads landing in every business bound to it).

**Inbound callbacks** (deauthorize, data deletion, webhooks) live in `src/app/api/<channel>/…`, verify the
channel's signature on the raw body **before** parsing, then hand verified data to a service.

**Errors:** adapters throw `ChannelError { code: "auth" | "rate_limited" | "policy" | "not_found" |
"invalid" | "transient" | "uncertain", retryable, channelCode }`. Plain owner words come from the domain
(the #1690 rejection copy becomes a per-channel map), never from provider text (#451).

**Fit check (Meta today → method):** every public `MetaClient` method and the Graph helpers in `oauth.ts`,
`capability-verification.ts`, `parent.ts` and `managed-provision-runner.ts` map to a method above. Lead
forms → `syncLeads` and `validate`; geo and interest resolution → `validate` and `editAudience`;
`switchAdSet`, `createCappedAdSet` and `deleteAdSetCopy` → inside `editAudience`/`activate`/`cleanup`;
`setAccountSpendCap` and `enforceCampaignSpendCap` → `enforceSpendCap`; WhatsApp number discovery and
managed provisioning → `connect` (Meta-only steps). Nothing needs a Meta word in the interface.
Owner media (#744): the library and consents are core; uploading to a channel (`adimages`/`advideos`) and its
spec checks happen inside `validate`/`launch`, driven by `capabilities.formats`.

### Data plan (Phase 3, DevOps)

| Change | Tables | Notes |
| --- | --- | --- |
| Add `channel text not null default 'meta'` | `campaigns`, `campaign_ads`, `campaign_results`, `ad_results`, `leads`, `lead_sync_runs`, `campaign_edit_operations`, `private.customer_ad_reservations`, `private.customer_ad_costs` | Default backfills every row in one statement |
| Add `external_id`, `external_status` | `campaigns`, `campaign_ads`, `ad_results`, `leads` | Backfill from `meta_campaign_id`, `meta_ad_id`, `effective_status`, `meta_lead_id` |
| New uniques beside the old ones | `(business_id, channel, external_id)` on campaigns and leads; `(campaign_id, channel, external_id, period)` on ad_results | Old Meta uniques stay until their columns are unread |
| Normalised result columns | `campaign_results`, `ad_results` | `results` **numeric** (Google conversions are fractional), `result_type`, `cost_per_result`, `clicks` + `click_kind` (`link` for Meta, `all` for Google), money in minor units |
| New `channel_connections` | `(business_id, channel)` primary key, `external_account_id`, `status`, `generation`, `capabilities` | Backfilled from `meta_connections`, which becomes Meta-private |
| Credentials stay per channel | `private.meta_tokens` stays; each new channel gets its own private token table | Credential shapes differ; one generic table would hide risk |

`channel_connections.generation` carries the **same counter** Meta writes check today (backfilled from
`meta_connections.generation`, never reset), so in-flight operations can't pass a stale check. The new
uniques and `channel_connections` ship with RLS (owner select via `owns_business`, service-only writes) and
metadb tests in the same migration.

All RPCs keep their names. New RPCs are channel-neutral (`channel_connection_status`). RLS and the metadb
tests cover every new column and table before release.

### Phases and owners

| Phase | Slices (small PRs, behaviour unchanged, `test:core` green) | Owner |
| --- | --- | --- |
| **1. Guardrails** | dependency-cruiser in CI with a generated baseline that can only shrink; rules: components and routes never import `channels/*` or `lib/meta`; `domain` imports no I/O; only `channels/meta` builds Graph URLs. File-size budget: new files ≤ 400 lines, existing big files listed and may only shrink. `knip` dead-code check (#1786). | CTO |
| **2. Meta behind the adapter** | In risk order, reads first, money writes last: (a) results + status sync, Dev 4; (b) leads + WhatsApp, Dev 2; (c) connect/OAuth/managed, Dev; (d) launch/validate/activate, Dev 3; (e) manage: pause, budget, audience switch, creative, Dev 2. Each slice also splits its part of `meta/client.ts` (2,436 lines) and `types.ts`. Slices (d) and (e) touch money and Meta writes: Reviewer + QA verdicts. | Devs; the Reviewer reviews every slice |
| **3. Channel-neutral data** | The migrations above, then reads switch to the new columns | DevOps + Dev 4 |
| **4. UI by feature** | Split `campaigns.tsx` (2,729), `ad-assistant.tsx`, `studio.tsx`, `lead-inbox.tsx` into feature folders; a channel badge and capability-driven options | Dev + Designer; QA walks |
| **5. Second-channel proof** | Google Ads read-only spike: connect, list campaigns, fetch results into the same card through the same service | CTO + Analyst |

**Exit test for the design:** Phase 5 shows Google results on a campaign card with no change to `services/results`
or the card. The card renders `unsupported` fields and fractional results without a Google branch, and provider
query languages (GAQL, Graph fields) stay inside the adapter. If the interface needs a Meta word or a Google special case in a service, the ADR is revised
before more slices land.

### Rules for every slice

- **Money gates stay in services:** funding mode, customer reservation and allowance, the managed spend-cap
  gate (`connection-access.ts`), `planGate` and `enforce-spend`'s weekly cap. Adapters only execute. Slices
  2(d) and 2(e) must show these calls unchanged.
- **#1775 (lead tenancy) is fixed before slice 2(b).**

- Pilot and P0 work comes first; each role keeps at least one product item while slices run.
- One path per PR, at most ~400 changed lines; move code and switch callers in the same PR, so there is
  never a second copy.
- Recorded core tests stay byte-for-byte; a slice that needs a fixture change is not behaviour-preserving.
- No new code may add to the boundary baseline once Phase 1 lands. The CI `boundaries` job enforces R1–R6
  (`.dependency-cruiser.mjs`) and the source checks C1–C4 (Graph URLs only in Meta's adapter, adapters touch
  only their own tables/RPCs, `appsecret_proof` on every Graph call, files ≤ 400 lines with listed big files
  capped at their size), all against `scripts/boundaries-baseline.json`, and prints each slice's −N (#2070, #2071).

### Provider access prerequisites

- **Meta:** #1838's rate-limit handling precedes pilot scale. Limited access has a
  60-point/five-minute account budget (writes cost three points); parallel campaign
  builds must share that budget, not each assume it is theirs. Track four separate
  gates in #156 (evidence: #2049), and don't let one stand in for another:
  - **Marketing API Access Tier** (Limited/Full; Meta's new name for Ads Management
    Standard Access). Approval is recorded historically; current Full entitlement is
    unknown. Full requires at least 500 successful Marketing API calls in the last
    15 days **and** an error rate under 15% over the last 500 calls. Our counters
    are unrecorded, which means unknown, not unmet. Do not generate calls just to
    qualify.
  - **Per-permission Advanced access** (App Review): submitted and in review, not
    approved. Keep the existing submission; no replacement packet.
  - **Business Verification:** reported verified; still required.
  - **Tech Provider Access Verification:** Meta retired it on Oct 9, 2026, but our
    Oct 28 receipt still shows "In Review". Treat it as neither a blocker nor done
    until the next planned owner-assisted review (CEO).

  Assume pilot scale fits Limited access until Full is confirmed.
- **Google:** #1826 supplies the Phase 5 access evidence. Developer tokens were
  sunset; access belongs to the OAuth client's Cloud project. Start the spike at
  **Test** access against test accounts, with no customer launch or production
  credentials. Explorer/Basic access and Cloud brand verification are separate
  prerequisites owned by DevOps if a production-account read becomes necessary.

### Risks

| Risk | Mitigation |
| --- | --- |
| Regressions in money or Meta-write paths | Those slices go last, with Reviewer + QA verdicts and the recorded core tests unchanged |
| Refactor conflicts with pilot work in the same files | One slice per file owner; small PRs merged the same day |
| Abstraction shaped only by Meta | Capabilities are data; Phase 5 tests the interface against Google before it's frozen |
| Two sources of truth during the data move | Additive columns written by both paths until reads switch; old columns unread before any cleanup (#1173) |
| Mac load from the boundary check | dependency-cruiser runs in CI only; locally, one targeted check |

### Non-goals

No ORM or framework change, no moves of `src/app` routes, no table renames or drops, and no customer launch
on a second channel inside this epic.
