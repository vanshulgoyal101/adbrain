# Meta

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module owns AdBrain's access to Meta: OAuth and asset selection, encrypted tokens, capability checks, managed accounts and the Graph API client. It does not decide campaign rules (budgets, review, spend caps); those live in [lib/campaign](../campaign/README.md).

## Start here

| File | Owns |
| --- | --- |
| [connection-access.ts](connection-access.ts) | `requireOwnedBusiness` and `withMetaConnection`: the checked way to get a Meta client for a business |
| [client.ts](client.ts) | `MetaClient`: Graph calls for campaigns, ads, insights and leads, plus `MetaError` types |
| [oauth.ts](oauth.ts) | Login URL, signed state, code exchange, asset discovery, signed deauthorize requests |
| [connection-repository.ts](connection-repository.ts) | Connection attempts and committing the selected ad account and Page |
| [token-store.ts](token-store.ts) | AES-256-GCM token encryption bound to the token and business |
| [capability-verification.ts](capability-verification.ts) | Which of insights, leads, create and activate the granted permissions allow |
| [managed-account.ts](managed-account.ts) / [managed-provision.ts](managed-provision.ts) | AdBrain-managed ad accounts (2-tier) |
| [graph-version.ts](graph-version.ts) | The pinned Graph API version |

## Rules

- Tenant Meta calls go through `withMetaConnection` with an `AuthorizedBusiness` from `requireOwnedBusiness` (signed-in owner), `requireScheduledBusiness` (scheduler secret) or `requireCampaignWorkerActor` (claimed worker job). It checks rollout, connection state, generation, binding and capability before building a `MetaClient` ([connection-access.ts](connection-access.ts)). `metaClientForBusiness` in [credentials.ts](credentials.ts) skips the purpose, generation and capability checks; it serves read paths (brand autofill, geo search, internal traffic), so don't use it for writes.
- Credentials come only from the business's own stored connection or managed account; environment tokens are never a tenant fallback ([credentials.ts](credentials.ts)). A managed business never falls back to OAuth.
- Pause and delete need the campaign's original binding and generation and the `ads_management` scope. Create and activate need the matching capability `available`; managed activation also needs spending room ([connection-access.ts](connection-access.ts)).
- Tokens stay on the server: connection DTOs never carry them, and ciphertext moved to another row or business does not decrypt ([token-store.ts](token-store.ts)).
- `MetaClient` retries one failed GET at most and never repeats a write. A business owned by the smoke login gets a pause-only client unless its ad account is a listed test account: its only writes are `validate_only` checks and pauses ([client.ts](client.ts), `metaWriteMode` in [internal-accounts.ts](../internal-accounts.ts)).
- Map Meta errors by code and subcode, not message text, which follows the token owner's locale. Throttles become `MetaThrottledError` ([client.ts](client.ts) `isThrottleCode`).
- A new create payload must match one Meta accepted with `validate_only` (the launch gate in `test:core`).

## Tests

- [Meta client against recorded Graph responses (core)](../../../tests/core/campaign-meta.test.ts), [Meta safety (core)](../../../tests/core/meta-safety.test.ts) and [throttling (core)](../../../tests/core/meta-throttle.test.ts)
- [Launch gate (core)](../../../tests/core/launch-validate.test.ts)
- [Connection access](../../../tests/meta-connection-access.test.ts), [connection safety](../../../tests/meta-connection-safety.test.ts) and [managed connection](../../../tests/meta-managed-connection.test.ts)
- [OAuth](../../../tests/meta-oauth.test.ts), [token store](../../../tests/meta-token-store.test.ts) and [credentials](../../../tests/meta-credentials.test.ts)
- [Meta client](../../../tests/meta-client.test.ts) and [capability verification](../../../tests/meta-capability-verification.test.ts)

## More

- [Meta facts](../../../docs/architecture/channels/meta.md): API version, permissions, [rate limits](../../../docs/architecture/channels/meta.md#rate-limits) and [fixtures and gates](../../../docs/architecture/channels/meta.md#fixtures-and-gates)
- [Meta connection and publishing](../../../docs/architecture/channels/meta-connect.md), including [token security](../../../docs/architecture/channels/meta-connect.md#token-security)
- [Meta connection API](../../../docs/api/meta.md)
- [ADR-001: channel adapters](../../../docs/architecture/adr-001-multi-channel.md)
