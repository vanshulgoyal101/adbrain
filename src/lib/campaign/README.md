# Campaign

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module owns AdBrain's campaign business rules: drafts, the planner, preflight review, durable creation, activation checks, spend guardrails, edits and results. It does not build Meta payloads or hold tokens; every Meta call goes through [lib/meta](../meta/README.md).

## Start here

| File | Owns |
| --- | --- |
| [draft-store.ts](draft-store.ts) | Versioned, owner-scoped drafts (seven-day expiry, at most 50 active) |
| [preflight-service.ts](preflight-service.ts) | `prepareCampaignReview`: loads the exact draft version and runs [preflight.ts](preflight.ts) |
| [preflight.ts](preflight.ts) | Review rules, blockers, `planHash` and `checkReviewFreshness` |
| [create-service.ts](create-service.ts) | `executeReviewedCampaign`: creates the reviewed campaign in Meta, PAUSED, and saves it |
| [operations.ts](operations.ts) | The create state machine: claim, phases, checkpoints, `needs_reconciliation` |
| [operation-store.ts](operation-store.ts) | `campaign_operations` RPCs: enqueue, claim, checkpoint, finish |
| [worker.ts](worker.ts) | Queued creation: rechecks ownership and review, then calls the same create service |
| [spend.ts](spend.ts) / [spend-enforce.ts](spend-enforce.ts) | Weekly cap decision and the auto-pause that applies it |

## Rules

- Creation never sends a stale review. The create service checks the creative hash against the review and passes the review's connection generation and binding to Meta access; the worker re-runs preflight and compares `planHash` and generation before it starts ([create-service.ts](create-service.ts), [worker.ts](worker.ts)).
- Meta objects are created PAUSED. Activation is a separate step with its own confirmation digest ([activation.ts](activation.ts) `activationConfirmationPayload`).
- A Meta write that may have happened is never replayed. Unless a phase failed before transmission or the client rolled it back, the operation becomes `needs_reconciliation`; a lost lease does the same ([operations.ts](operations.ts)).
- One idempotency key means one request: a different business, key, request hash or generation is a `conflict`, and a finished operation is a `replay` ([operations.ts](operations.ts) `claimOperation`).
- Service-role campaign writes go through [trusted-write.ts](trusted-write.ts), which re-checks that the user owns the business and scopes every write to it.
- Spend auto-pause fails closed: an unreadable spend, wrong currency or wrong week pauses every active campaign instead of counting zero ([spend.ts](spend.ts) `weeklySpendDecision`). Another business's duplicate of a campaign is neither counted nor paused ([campaign-owner.ts](campaign-owner.ts)).
- Changes to generation, the planner, preflight or Meta calls need a `test:core` test with recorded responses (see [AGENTS.md](../../../AGENTS.md)).

## Tests

- [Launch routes (core)](../../../tests/core/launch-routes.test.ts) and [campaign preflight (core)](../../../tests/core/campaign-preflight.test.ts)
- [Operation state machine](../../../tests/meta-connect-w2-operations-comprehensive.test.ts) and [operation store](../../../tests/meta-connect-w2-operation-store.test.ts)
- [Preflight service](../../../tests/meta-connect-w2-preflight-service.test.ts) and [draft store](../../../tests/meta-connect-w2-draft-store.test.ts)
- [Campaign worker](../../../tests/campaign-worker.test.ts) and [trusted writes](../../../tests/campaign-trusted-write.test.ts)
- [Spend rules](../../../tests/spend.test.ts) and [spend enforcement](../../../tests/audit-spend-enforce.test.ts)

## More

- [Campaign data flow](../../../docs/architecture/overview.md#campaign-data-flow): draft version, connection generation and `planHash`
- [Campaign execution boundaries](../../../docs/architecture/overview-boundaries.md#campaign-execution-and-read-models)
- [From draft to campaign](../../../docs/architecture/channels/meta-connect.md#from-draft-to-campaign) and [recovery](../../../docs/architecture/channels/meta-connect.md#recovery-and-destructive-actions)
- [Campaigns API](../../../docs/api/campaigns.md#review-and-durable-creation) and the [worker runbook](../../../docs/operations/runbooks/campaigns.md#campaign-worker-rollout)
