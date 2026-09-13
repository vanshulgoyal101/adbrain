# Flare Production Switch: 2026-09-12

This is a historical deployment receipt. The subsequent September 13 branch
synchronization aligns the source default, example configuration, and local model
setting with Flare. The original configuration state below describes September 12.

The owner approved a production-only model configuration change, redeployment
of the current released code, and one paid image test without automatic retry,
targeting less than USD 0.50 incremental spend.

## Deployment

- Changed only production `OPENROUTER_IMAGE_MODEL` from
  `openai/gpt-image-2` to `openai/gpt-image-2.5-flare`.
- Vercel project: `prj_LNNhyKmbQYXyBUNadG2hZJSLDjOw` (AdBrain).
- Rebuilt released deployment `dpl_4FLyDt2GQfEJsXyUD82hXM6Jjd4t`, whose code
  was released at `1af960123597b05b09a0342d8801ae0d18c7ad5a`.
- New deployment `dpl_5Fv4tdY2jDKtFQTTZFXqYcqXGp5q` is Ready and serves
  `https://adbrain.vanshul.com` and `https://adsvanz.app`.
- Existing adapter selects medium quality and disables provider fallback.
- No application-code, key, budget, text-model, database, or Meta changes.
  Local environment and source-code fallback remain GPT Image 2; production's
  explicit environment override selects Flare. No Git commit or push performed.

## Actual Paid Result

The dedicated Cedar Ridge demo account submitted exactly one generation POST
with `count: 1`, reusing the brief from creative
`2eed374b-3a92-459a-877b-ded8b1c08c20`. No interview call or paid retry was made.

| Measurement | Previous GPT Image 2 Sample | Flare Sample |
| --- | ---: | ---: |
| Image receipt cost, USD | 0.05240 | 0.01372 |
| Image latency | 35.54 seconds | 14.49 seconds |
| Source dimensions | 1152 x 1536 | 1024 x 1536 |

Flare's sample image cost was 73.8% lower and image generation was 2.45 times
as fast. This is not a controlled model benchmark: the brief was reused, but
the concept/image prompt was regenerated and output dimensions differed.
It is one successful sample, not evidence of average costs, failure rates,
three-variant reliability, or timeout recovery.

- Generation POST returned HTTP 200 in 65.988 seconds, including concept work,
  image generation, composition, and persistence, but no interview.
- Key usage before: USD 2.665861; after: USD 2.692621.
- Observed incremental key usage: USD 0.026760. Of this, the image receipt
  reports USD 0.013720; the remaining USD 0.013040 is consistent with text work.
  Key-wide deltas can include concurrent requests and are not independently
  attributed per-request text charges. Credit-purchase fees/taxes are excluded.
- Key limit remains USD 5; remaining headroom after test: USD 2.307379.
- New creative: `64abd743-4f20-418a-af29-920a17a9af6b`, left in `draft`.
- [Open the saved draft](https://adbrain.vanshul.com/studio?creative=64abd743-4f20-418a-af29-920a17a9af6b)
  while signed in to the demo account.

The owner-scoped database read verified the saved model and cost. The image
download returned HTTP 200, Sharp validated the raster, and the finished
1080 x 1350 ad was visually inspected. A read-only fresh browser login verified
the saved image loads in Studio. The initial screenshot was taken before images
loaded; a later image-load wait corrected the screenshot without another paid call.

## Evidence and Repeat Protection

- Harness: `scripts/check-flare-production.mjs`; syntax and ESLint passed.
- Private, Git-ignored evidence: `.creative-evals/flare-2026-09-12/` contains
  `report.json`, `creative.png`, `studio.png`, and `submitted-once.json`.
- The exclusive-create guard `submitted-once.json` consumes this authorization.
  Do not delete it or repeat paid generation without fresh owner approval.
- `node --env-file=.env.local scripts/check-flare-production.mjs --review-only`
  verifies the existing draft without any generation POST.
- No test browser or local development server was left running.

A rollback would restore the production model setting to `openai/gpt-image-2`
and rebuild the released deployment, with explicit approval. The saved Flare
creative and its receipt do not depend on keeping Flare configured.