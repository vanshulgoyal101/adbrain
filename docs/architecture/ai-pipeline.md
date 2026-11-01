# AI and Creative Pipeline

Part of [Architecture](README.md). [Interview and boundaries](ai-pipeline.md) · [Variant generation](ai-pipeline-variants.md) · [Routing, images and cost](ai-pipeline-routing.md).

This guide describes model calls, image processing, retries, and accounting.
Parameters are in [Configuration](../operations/configuration.md) and [API Reference](../api/README.md).
Design history lives in git history; it does not override current code.

## Task Boundaries

| Task | Entry / main implementation | Result |
| --- | --- | --- |
| Website extraction | [autofill route](../../src/app/api/brand/autofill/route.ts), template builders | Proposed brand fields, not an automatic save |
| Creative interview | [interview](../../src/lib/creative/interview.ts) | Next question or editable brief |
| Creative generation | [generate](../../src/lib/creative/generate.ts), [concept](../../src/lib/creative/concept.ts) | Validated concept/copy, image, design spec |
| Campaign planning | [planner](../../src/lib/campaign/planner.ts), [draft conversion](../../src/lib/campaign/planner-draft.ts) | Reviewed draft or audience proposal, not direct publication |
| Results summary | [summary](../../src/lib/creative/summary.ts) | Plain-language interpretation of supplied metrics |

## Interview

Saved brand facts, active instructions, goal, answer history, recent goals, and
optional reference brief form the context. The interviewer can finish with zero
questions and may ask at most three new decisions. Field/ID/history checks reject
repeated decisions and recycled options. Structured output and commercial-claim
checks prevent some unsupported terms, not all misleading claims in every language.
When declared preferences are enabled, a bounded advisory note may guide style,
but wording copied only from that note cannot establish a factual brief. The
interview checks positive support in current owner answers or factual Brand fields;
negated requests, Brand voice and model-derived reference briefs are not factual
support. This check cannot recognize every paraphrase, so generation must also
keep the generated brief separate from verified claim evidence.

There is one repair opportunity, sharing a 45-second deadline and request
cancellation. Accepted brief length is at most 2000 characters. Follow-up
recommendations are optional; the user reviews the next brief before generating.
An interview response does not itself produce paid image variants.
Options that mean "I'll type my own" (custom, other, type below) are dropped and the
text box is kept. An answer that adds no fact (such a chip, skip, not sure) does not
count as a repeat, so the question can be asked again. A currency amount such as
"₹10,000" is supported by "10,000 rupees" or "Rs 10000" in a source (#284).
Options on an `offer` question are proposals the owner picks or rejects, so they skip the
commercial-claim check; the AI can't pick one for the owner (`allowRandom` and
`aiCanDecide` are off). When the repair still states an unsupported term and that is
the only failure, the sentences, recommendations or options with the term are dropped
and the result is re-checked; it is returned only if every check passes and the brief
keeps at least 40 characters (#613).
Past results (#371): when the business has a campaign with stored results from the last
60 days and spend above zero, the interview gets a `PAST RESULTS` block after the
reference brief (the cheapest campaign per result and the weakest, built in
`src/lib/campaign/result-evidence.ts`) and one system rule: use them only for angle, hook
and format; offers and claims still need a Brand fact. An ad is credited only when its
campaign ran one ad. The wording is fixed in code: under 5 results "early: based on N
chats", 5–19 "so far", 20+ plain, none "₹X spent, no chats yet". Without results the
prompt is unchanged. The concept fact check never sees past results.
Failed attempts log rule names only (`metadata.validationRules`, for example
`unsupported-commercial-claim`, `repeated-question`, `schema:<path>`). The interview
adds the term's class, never the term: `unsupported-commercial-claim:free`, `:percent`,
`:currency` or `:guarantee` (#613). A Brand fact supports a term unless that term itself
is negated or withdrawn ("no free survey", "isn't free", "don't offer free", "Free survey no longer
offered"); a negation about something else ("Free survey, no obligation") doesn't count.
A subsidy line (`subsidy`, `PM Surya Ghar`, `सब्सिडी`, `ਸਬਸਿਡੀ`; class `:subsidy`, #1676) needs a Brand
fact that states it with no negated mention ("Not a subsidy vendor" refuses it); any such fact counts, quoted
or not. It is a claim, not an offer, so the above-the-fold offer rule ignores it.

### Campaign Interview

The campaign planner is a separate workflow from the creative interviewer above.
The September 29 source change uses `campaign-planner-v5` and keeps structured
`questionId`, `topic`, answer and `answered`/`deferred` disposition across turns.
Brand context and explicitly selected campaign settings are supplied with history.
Known single service areas/offers and manual settings do not need confirmation;
exclusions default empty unless requested, and the planner recommends creatives
and technical targeting rather than asking the owner for API IDs or ad jargon.
`campaign-planner-v6` (#686) asks for interests named the way Meta names them
(topics, hobbies, activities, life events), not professions, specialties or
symptoms. On production's Cedar Ridge facts this took plans with no Meta match from
1 in 5 to 0 in 5, and resolved interests from 30% to 84% (Solaride unchanged, 0 in 5).
Goal interpretation remains model-driven, including natural-language city/radius
requests; a prompt example is not a guarantee of correct interpretation.

Questions have a fixed topic enum. The server filters previously answered/deferred
topics, repeated IDs and normalized question text, deduplicates topics within the
response, and returns at most two useful questions per turn. After six supplied
decisions it permits one final plan attempt but no more questions. Missing or
repeated output gets at most one correction call under the same 45-second deadline;
transport/provider failures are not retried by this progress check. Each completed
attempt retains usage and validity metadata. The planner uses budget routing
(`LLM_BUDGET_PROVIDER_ORDER`) with a 20-second attempt deadline, because the
standard reasoning model needs 30-90 seconds per plan. For speed (#366, #668) it
sends `thinking: "off"`: a zero thinking budget on Gemini (5-second cap) and
`reasoning: {effort: "none"}` on OpenRouter. OpenRouter (production's Claude Haiku)
is tried right after the first budget provider (`nextProviders`), and on a short
429 the router tries it before waiting out the cooldown, coming back afterwards
(`fallbackBeforeRateLimitWait`). Recorded: Groq ~1 s, Haiku 3-5 s with reasoning
off (6-8 s and ~800 extra tokens with it on), Gemini 4-5 s or a timeout. Other
budget tasks still never use OpenRouter. Provider routing has its own
bounded fallback behavior; two planner attempts are not a guarantee of only two
physical provider requests.

A deferred budget/compliance decision without an explicit editor value stops for
manual completion; skipping is not permission to invent spending or compliance.
No-progress and question-limit responses contain an editor `handoff`, not another
question loop or fabricated plan. Guided UI persists submitted answers and the
handoff per business/destination in session storage, and offers the existing
campaign editor with a goal/answer summary capped at 2000 characters. The full
submitted transcript remains in that browser session; this is not a durable,
cross-device checkpoint. Transport failures retain the exact pending request for
explicit retry. A lost successful draft response still requires checking Saved
drafts before retry; this change does not add server-side planner idempotency.

Audience-only recommendations preserve an explicitly selected radius as well as
manual location/age settings. Both callers display the no-progress handoff without
creating a campaign. Preflight, approved-creative checks, ownership, special-category
restrictions, paused creation and explicit activation remain authoritative.
A planner label of housing or financial products is read as none unless the business
itself lends, insures or sells property, and employment is read as none for an education
business that doesn't recruit, so a shop's 'EMI available' or an interiors offer never
blocks a launch; a lender, property seller or recruiter keeps the block (#1671).
Lending and property checks use the business vertical (advisers, wealth, chit funds,
trading, realtors, land and townships count; so do pawn brokers, money lenders, sood/girvi,
rooms, kiraya, 1RK and flatmates, but not vehicles or equipment on rent, hotels, or room
interiors, #2370), not offers mentioning its bank,
credit-card EMI or flat interiors; an offer selling a loan, insurance, a SIP, a mutual
fund, an investment plan or an insurance policy keeps the financial block, while a
return policy or 'investment for your home' doesn't (#2097). Education terms match whole words;
recruiting in either the vertical or offers keeps the employment block. A missing
or blank vertical preserves the planner's category.
The `campaign.interview` workflow event records fixed no-progress/limit codes,
not conversation text. These are source claims, not deployed conversation results.
The `campaign.plan` event is `success` for a ready plan, `partial` when it falls
back (`PLAN_AUDIENCE_NO_META_INTERESTS`, questions, a failed interest lookup) and
`failed` otherwise; `count` and `failedCount` are the suggested and unresolved
interest counts, never the names (#686); `durationMs` is Prepare's end-to-end time (#821). A concept whose `visual.direction` shows an empty scene
(an empty or bare space, a reception or waiting room) with no person, team or product is
refused as `no-subject` before any image is paid for, and repaired once ([visual-rules.ts](../../src/lib/creative/visual-rules.ts), #760). The `creative.batch` event carries the
batch's wall time (`durationMs`, from the request to the saved batch) and its image
path (`provider`: `cloudflare` or `pollinations` for internal accounts, `paid` for customers) and its
estimated AI cost (`costUsd`, `textCostUsd`, `imageCostUsd`; the scoreboard shows the median, #1468), so
Create speed is timed per path; usage rows are written when the batch ends and
can't time it (#681). When the first pass saves fewer ads than asked, one top-up
round remakes the angles whose concept or image failed (never "no provider" or every
provider down), in parallel and in the same request, through the same validators and
repair. It starts only if the first pass ended within 60 s and is cut off after 45 s
(`CREATE_TOP_UP_*` in [stream.ts](../../src/lib/creative/stream.ts)); the stream sends
`{ type: "topUp", missing }`, the page says "Making N more…", and `creative.batch`
records `topUp`, the number of ads retried (#1123). On a `+prospect` account (a sales
visit, free pictures) an ad that lost only its picture is not remade: once the first pass
ends, it gets one more free picture with the words that already passed (no text call,
₹0), if at least 45 s remain before 250 s (`PROSPECT_PICTURE_RETRY_*`). The stream sends
`{ type: "topUp", missing, kind: "picture" }`, the page says "N pictures didn't come
through. Trying again…", and `creative.batch` records `pictureRetry` (#1547). A finished ad
(words passed, picture stored) is saved by [save.ts](../../src/lib/creative/save.ts) under an id made
before the insert: a failed insert is read back (it may have landed) and retried once unless its
database code would fail again (`22`/`23`/`42`/`PGRST2`), and each failed attempt records
`creative.save` with that code (#2494). A refused commercial claim in Create adds a
`claim:<class>:<reason>` validation rule to its usage row (class `free`/`percent`/
`currency`/`guarantee`; reason `uncited`, or `negated-quote` when a quote cited it but a
negation elsewhere in that quote refused it), never the term or the copy (#687).
Create also applies Meta ad-policy rules ([policy-rules.ts](../../src/lib/creative/policy-rules.ts), #738),
repairing once like any other rule: `personal-attribute` (in health verticals, a question or
"your …" naming the reader's symptom or condition, or suggesting they neglected care; in any
vertical, a question about the reader's money trouble such as debt or a bill that "feels heavy"),
`unsupported-superlative` (#1, top-rated, leading, "Austin's best" unless a supplied fact says it)
and `exaggerated-result` ("up to N%": refused in health verticals even when a fact states it;
elsewhere allowed when a supplied fact states the same figure, refused when uncited; also, #941, a zero-cost
claim ("zero investment", "₹0 down payment"), a result-or-refund promise ("no band, no fee", "money-back") and a
timed result ("new teeth in days", "fluency in 30 days"), each refused unless a supplied fact states it, and a timed
result always refused in health verticals). Health verticals also ban implied
outcomes (lasting relief, eliminate, fix your, feel better…) and any guarantee, cited or not. Owner-typed
copy only gets these as warnings.

### Orchestration Reuse

Keep the existing pinned AI SDK Core (`ai` 7.0.116, Apache-2.0) and Zod structured
output behind the provider facade. It already owns model transport, schema output
and provider compatibility; the interview state/progress rules are AdBrain domain
logic. No new framework, dependency upgrade or paid provider is needed for this fix.

This follows [Anthropic's simple workflow guidance](https://www.anthropic.com/engineering/building-effective-agents)
and [AI SDK structured workflows/agent guidance](https://ai-sdk.dev/docs/agents/overview):
explicit state, bounded steps and a clear handoff instead of an unconstrained loop.
The [loop-control guide](https://ai-sdk.dev/docs/agents/loop-control) distinguishes
tool-loop agents from manually controlled structured workflows. Use ToolLoopAgent
when a real tool-selection loop becomes necessary, preserving current tenant,
usage, cancellation and provider-selection controls.

[LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview) is worth
considering for durable multi-session workflows, not as an automatic question-quality
fix. Its [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
need a durable checkpointer, tenant-scoped thread identity and replay-safe effects;
adopting it would require persistence integration and migration, not merely a prompt
swap. A general coding harness is not a drop-in campaign runtime. Do not grant shell,
filesystem or unrestricted provider tools to solve a bounded interview problem.

Focused regressions live in the existing planner, campaign-chat and planner-route
suites, with one manual-audience handoff case. They reproduce lost IDs/deferrals,
paraphrased topic repetition, known-fact reuse, correction usage, cancellation,
question limits, reload recovery and radius preservation. Synthetic tests establish
these contracts, not a live-model quality score. Use real authorized conversation
feedback to assess unnecessary questions, abandonment and time to a useful draft.
