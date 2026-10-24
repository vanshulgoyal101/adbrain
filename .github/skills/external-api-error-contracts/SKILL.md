---
name: external-api-error-contracts
description: "Use this skill when a product integrates with a provider API whose errors are localized, unstable, overly technical, or capable of changing business behavior such as destination, campaign type, billing or permissions."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/external-api-error-contracts.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# External API Error Contracts

## Trigger

Use this skill when a product integrates with a provider API whose errors are
localized, unstable, overly technical, or capable of changing business behavior
such as destination, campaign type, billing or permissions.

## Invariant

Provider failures are translated into stable customer-facing guidance while
preserving safe status and diagnostic context for operators. The application
never silently changes a requested business outcome to make the provider call
succeed.

## Failure pattern

Raw Graph API text reaches the UI, often in another language or with internal
field names. A human CTA is sent as a provider enum that is invalid for the
selected objective. A missing capability causes the code to silently switch from
WhatsApp/call to an instant form, creating a campaign different from the user's
request.

## Recommended method

1. Keep provider-specific errors in a typed error class with safe status and
   internal category fields.
2. Map known categories such as permissions, CTA validation, audience, budget,
   image and expired connection to stable guidance. Use a generic fallback for
   unknown errors; never expose raw tokens, URLs or full provider responses.
3. Normalize human-facing labels separately from provider enums. Treat creative
   presentation copy as untrusted input to the provider contract.
4. Validate stale selections, such as lead forms, against the provider immediately
   before mutation.
5. Preserve the requested destination. If a capability is unavailable, stop and
   explain how to fix it instead of silently substituting another destination.
6. Validate external image URLs and schemes before fetching or uploading them.
7. Test localized/opaque errors, malformed inputs, stale resources and unsupported
   capabilities at the adapter and route boundaries.
8. Treat a 200 response with no usable result (a handoff, clarifying questions,
   an invalid plan) as a failure path, not success. One production step returned
   200 in 5s with no targeting and the editor showed an error.
9. Drop values that carry no meaning in context before strict validation. A model
   sent a 0 radius for city-only targeting where the schema requires 17-80; both
   attempts failed validation until 0/null was dropped first. Replay the real reply
   in a test.
10. Give every AI step in the core flow a deterministic non-AI fallback (the user's
   own choices plus safe defaults) and show the user a notice when it is used.
11. Preflight rules a provider enforces late: it created a campaign and ad set,
   then rejected an ad linking to its own site. Check before any write (#109).
12. Record a `validate_only` reply for every object of a never-run Meta path first. Meta
   checks the ad set against its parent campaign and the Page's WhatsApp link (#209).

## Discriminating checks

- A localized CTA error produces stable CTA guidance, not the original text.
- An expired token produces reconnect guidance.
- A stale lead form is rejected before campaign creation.
- A WhatsApp/call capability failure returns an actionable error and does not
  create an instant-form campaign.
- A malformed or non-HTTP image URL is rejected before `fetch`.
- Unknown provider errors use the safe fallback message.

## Ambiguous mutation outcomes

- A timeout, dropped response, or server error after an external mutation is an
   unknown outcome, not evidence that nothing happened. Saved partial work may
   exist even when the client sees failure.
- Assign an operation identity before submission and bind reconciliation reads
   to that identity and the authorized tenant. Recovery must not create a fresh
   paid request merely because the user clicks the retry control.
- Bound status checks and expose a recoverable unknown/partial state. If the
   provider outcome cannot be established safely, require reconciliation instead
   of automatic resubmission. A provider ID or persistence checkpoint is not proof
   that the entire operation finished.
- Fence durable terminal transitions so late failures cannot overwrite success;
   retain known external IDs when local checkpoint or finalization writes fail.
- Distinguish a correlation ID from server-enforced idempotency. A client ref
   can protect a mounted view's retry but does not survive reload, prevent another
   tab from submitting, or enforce uniqueness across concurrent server requests.
- Regression check: simulate an ambiguous POST, click retry, and assert exactly
   one mutation request plus read-only checks with the original identity. Cover
   partial/empty results, unauthorized reads, tenant filters, and safe DB errors.
- Persist the provider's own request/generation ID for every attempt, including
   failed and fallback attempts. Without it, settling an unknown outcome may need
   an account-admin export that the application key cannot read.
- A provider read failure is not an empty result. Do not report it as skipped or
   unmatched; return a safe error before any local write.
- Version reconciliation receipts so a new operator path refuses records created
   before the evidence existed, and lock the parent row so late usage or output
   inserts cannot land after the reconciliation audit.
- Give each terminal state a way out, such as starting over with a note on what
   sync will import. A lock only a new tab clears is a dead end (#143).

## Common traps

- Returning `(err as Error).message` directly from every route.
- Reusing a creative CTA string as a Graph API enum without an objective check.
- Catching a capability error and mutating the user's requested destination.
- Validating a selected provider resource only when it was initially loaded.
- Logging or returning access tokens and complete provider payloads.
- Formatting every route error with one provider's formatter. An AI planner
  truncation surfaced as "Meta rejected the budget settings" and sent debugging
  to the wrong system. Classify by the stage that failed before choosing a message.
  The old test mocked the formatter and hid it; a failing test with the exact
  payload through the real formatter caught it.
- Labelling an activation as "Resume". In AdBrain, Resume reserved spend and set
  the Meta campaign ACTIVE; test plans must treat it as spending, not as a toggle.
- Matching provider error text. The user message follows the token owner's
  locale; map by error code and subcode, checked against recorded bodies (#185).
- Binding to "the first" item of a provider list. Lists can be newest-first, so
  adding an ad set changed which one was first; bind by stored ID (#197).
- Treating a default listing as complete. One hid archived ads until the status
  filter was passed explicitly (#188).
- Assuming the Page's `whatsapp_number` must be set: Meta accepted a WhatsApp Business
  Account number in `promoted_object.whatsapp_phone_number` with that field empty (#209).
- Requiring `CONNECTED` WhatsApp numbers: one read `DISCONNECTED`/`NOT_VERIFIED` (its API
  connection), yet its ad delivered and a chat was answered in the Business app (#286).
- Filing a delivery-blocker fix before checking live outcomes. Hours of early 0
  impressions can be the auction/learning phase, not a configuration fault (#286).

## Evidence

AdBrain's Meta hardening added `friendlyMetaError`, safe lead-form freshness
validation, strict destination preservation, CTA normalization and image URL
validation after provider errors reached users as localized/internal failures.

AdBrain's September 2026 recovery tests separately covered component-scoped
creative retries and durable campaign-operation checkpoints. The creative test
asserted one POST across two recovery attempts; it did not prove cross-reload
idempotency or real-provider timeout recovery. Campaign failure tests retained
known IDs and returned reconciliation when local persistence failed.

October 2026: AdBrain's campaign Prepare step gained a non-AI fallback, then
fell back on 200-with-handoff responses and dropped a zero radius before
validation. Production returned 200 in 4.4s with real targeting; the handoff and
radius fixes each have a core test that fails without them
([incident](../incidents/adbrain-create-reliability-2026-10.md)).
