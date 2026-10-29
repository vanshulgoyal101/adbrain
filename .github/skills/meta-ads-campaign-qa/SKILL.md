---
name: meta-ads-campaign-qa
description: "Use before any change to what AdBrain sends Meta (campaigns, ad sets, targeting, creatives, ads, budgets, placements) and before launching or changing a campaign: dry-run every object with Meta's validate_only, keep the recorded launch gate green, and check the plan against new-advertiser guidance. Never edit a live run."
---

<!-- AdBrain's own skill (#419), written in this repo. AGENTS.md and docs/team/orchestration.md win on any conflict. -->

# Meta ads campaign QA

## Trigger

You are changing `src/lib/meta/client.ts`, targeting, budgets, placements, creatives or the
launch flow, or you are about to launch, activate or change a Meta campaign.

## Rules that don't bend

- **Never edit a live run.** Any significant edit (targeting, budget, creative, optimisation)
  restarts Meta's learning phase. Prepare the change for the **next** run instead.
- **No spend without a CEO `decision`.** Test spend, budget changes and cap changes are money.
- **Ads are never created to test.** Use `execution_options=["validate_only"]`. A PAUSED
  parent (campaign, empty ad set, creative) may exist briefly so a child can be validated,
  and must be deleted in `finally`.
- **No secrets in tapes.** Scrub tokens, account, Page, lead form, image hashes and phone
  numbers to placeholders before writing a fixture.

## Steps

1. **Gate first.** Run `npx vitest run tests/core/launch-validate.test.ts`. It replays today's
   `createLeadCampaign` for lead-form and WhatsApp campaigns and requires every POST to equal a
   payload Meta accepted with `validate_only`.
2. **If you changed a payload on purpose**, re-record:
   `npx tsx --env-file=<.env.local> scripts/record-meta-launch-validate.ts`. Read every Meta
   answer (status and `error_subcode`), not just the count. Add a case to the recorder for any
   new path (for example a 9:16 placement creative) so the gate covers it.
3. **Check the plan:** `npx tsx scripts/plan-check.ts --cost-per-result <₹ from the latest
   results>`. It must pass Advantage+ audience; treat each warning as a decision for the CEO
   (budget) or the owner of that track (placements, assets).
4. **Prove it:** `npm run test:core` green, the recorder output (scrubbed) and the plan-check
   output in the PR. Merge only through the current release route (see ORCHESTRATION).

## What Meta told us (recorded, not guessed)

- **Advantage+ audience** (`targeting_automation.advantage_audience: 1`): a hard `age_min` above
  25 is refused (subcode **1870188**); a hard `age_max` below 65 is refused (**1870189**). Send
  the owner's range as `age_range` (a suggestion); area and exclusions stay hard. From v23 the
  flag defaults to on. Tape: `tests/core/fixtures/meta/advantage-audience-validate.json`.
- **Placement creatives** (`asset_feed_spec` with Stories/Reels rules): the ad is refused with
  **1772103** ("Instagram account is missing") unless `object_story_spec.instagram_user_id`
  names the Page's Instagram account (#333/#447).
- **Learning phase:** Meta needs about **50 optimisation events in 7 days** after the last
  significant edit. At ₹280 a day and ~₹69 a chat a run gets ~28 a week, so it can stay
  "learning limited"; `plan-check` shows the budget that would reach 50.

## Done when

The gate is green on the final payloads, any re-recording is reviewed answer by answer, the
plan check's failures are fixed and its warnings are raised with their owner, and nothing
touched a live run or spent money.
