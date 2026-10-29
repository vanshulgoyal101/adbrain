# Roadmap

What AdBrain works on next and why: outcomes, not delivery promises. The
ranked list and its evidence live on
[#703](https://github.com/vanshulgoyal101/adbrain/issues/703); who does what is in the
[current dispatch](ORCHESTRATION.md#current-dispatch); what the product does today is in
[Features](product/README.md). This page holds current truth only; git keeps the history.

**The core loop comes first:** Brand → Create → Review → Launch on Meta → Manage
and results. Every item below must help a local business get more real enquiries
for less money, faster and more easily, and must not break that loop
([AGENTS.md](../AGENTS.md)).

## Current Priorities

| # | Outcome | Tracked in | Done when |
| --- | --- | --- | --- |
| 1 | **First outside pilots live**: rooftop solar, IELTS/study-abroad, interior designers and modular kitchens in the Tricity area (clinics paused, [#1427](https://github.com/vanshulgoyal101/adbrain/issues/1427)) | [#679](https://github.com/vanshulgoyal101/adbrain/issues/679), [#1315](https://github.com/vanshulgoyal101/adbrain/issues/1315) | 3 outside businesses meet the 'pilot live' definition on #1315 (their own account, the owner switched it on, delivering) within 2 weeks of October 28; the first case study reaches 'Proven' by week 4 |
| 2 | **More WhatsApp chats per ₹** | [#680](https://github.com/vanshulgoyal101/adbrain/issues/680), [#1174](https://github.com/vanshulgoyal101/adbrain/issues/1174) | One lever per run, judged with the decision rule below; results in the [#588](https://github.com/vanshulgoyal101/adbrain/issues/588) ledger |
| 3 | **A reliable, fast core loop** | [#681](https://github.com/vanshulgoyal101/adbrain/issues/681) | Every step meets its target on the daily core scoreboard for 3 days running |
| 4 | **Effortless on a phone** | [#1226](https://github.com/vanshulgoyal101/adbrain/issues/1226) | Sign-up to live in ≤ 10 minutes and ≤ 12 taps; results understood in 3 seconds (WS1–WS3 first) |
| 5 | **Never show AdBrain's margin** | [#1235](https://github.com/vanshulgoyal101/adbrain/issues/1235) | No screen, receipt or message shows a split, a fee share or a pair of figures that subtracts to one |

### WhatsApp-first product ranking (CEO decision, October 27, 2026)

The CEO chose WhatsApp as the primary enquiry channel after repeated pilot
experience. Lead-form experiments are now later work, not the next build target.
The smallest measurable sequence is:

1. **Ice breakers (W1, #905):** three tap-to-send customer questions built from
   Brand facts (each 40 characters or fewer, approved by the CEO for the pilot).
   Ice-breaker mode replaces the prefill and Call button for that run. Live
   since #995; suggestions that read as real customer questions are #1114. Runs
   first in the next controlled run (#680).
2. **Ad-only handoff levers (#1174), one per run after W1:** L1 says what
   happens after the tap (the ad's last line quotes the pre-typed message); L2
   puts the offer up front (headline, first line and picture; the ad asks for
   a WhatsApp message instead of a call, #1147); L3 uses the owner's real
   install photos. The WhatsApp opening stays exactly the owner's saved
   template. Review's open-to-message rate is live (#1087).
3. **Reply speed (#1049, live):** reply or call from the enquiry card in one tap;
   `contacted at` and the median time to first reply show on Home.
4. **Owner alerts (#701):** deliver new enquiries and a daily results line to
   the owner's WhatsApp, subject to the CEO's rate-card and spend-cap decision.

**Decision rule for each run (#1366):** judge open-to-message (messages ÷
WhatsApp opens) once a run has at least 30 opens. Pass at 6 or more messages
out of about 35 opens; fail at 3 or fewer; with 4 or 5, run the same lever
once more and pass at 11 or more out of about 70. The pooled baseline is
about 5% (6 of 125). A pass means "keep it", not proof.

**Rule (owner, October 28, 2026):** AdBrain never sends customers automated
WhatsApp messages beyond the owner's saved template. Quick questions (W1) are
buttons the customer chooses, so they are allowed, and the owner's welcome
text stays unchanged. Custom greetings and promised reply times are not
allowed. Owner alerts (#701) go to the owner, not to customers.

Manage work that supports this loop: per-ad results and the Best rule (#783,
live), Run this again (#1050) and editing a launched campaign (#765).

This ranking is tracked in [#703](https://github.com/vanshulgoyal101/adbrain/issues/703).
Each experiment must use the existing ledger and a recorded core acceptance; no
live ad or Meta object is changed by the ranking itself.

## Pilots and Money

- Pilot businesses use **their own** Meta ad account and Page and pay Meta directly. AdBrain sets up the first campaign free. **Price (CEO, [#718](https://github.com/vanshulgoyal101/adbrain/issues/718)):** ₹999 a month, first month free, no auto-debit; the first 10 customers use the own-ad-account path only.
- Go live's first run is 2 days by default (₹300 a day, stops at ₹708 including Meta's GST); step 3 offers 7 days, which pilots use (₹2,478 at most, no mid-run edits; CEO, [#1530](https://github.com/vanshulgoyal101/adbrain/issues/1530)).
- Until Meta's App Review ([#156](https://github.com/vanshulgoyal101/adbrain/issues/156)) is approved, each pilot owner connects as an app Tester.
- AdBrain's own checkout and per-customer ad balances exist in source behind flags ([Payments plan](PAYMENTS-PLAN.md)). Whether they go live or are removed is a CEO decision due November 11, 2026 ([#1171](https://github.com/vanshulgoyal101/adbrain/issues/1171)).
- Numbers shown to owners come from AdBrain's own ledger with the sample size, never from industry benchmarks. A comparison sentence needs at least 20 pooled results for that kind of business ([#1255](https://github.com/vanshulgoyal101/adbrain/issues/1255)).

## Next, Once the Pilots Run

- **Google Search and Business Profile** as the next channel for businesses people search for (repairs, B2B). Start: the developer-token application (no build) ([#1241](https://github.com/vanshulgoyal101/adbrain/issues/1241), [#510](https://github.com/vanshulgoyal101/adbrain/issues/510)).
- **The app in Hindi**, one screen per slice from the CPO's tables, then Punjabi for the 3 most-used screens ([#1438](https://github.com/vanshulgoyal101/adbrain/issues/1438)). Home is live behind Settings › App language.
- **Fill the Brand from the owner's Facebook Page** ([#1238](https://github.com/vanshulgoyal101/adbrain/issues/1238)), and a daily 'what I'd change' line that never raises spend on its own ([#799](https://github.com/vanshulgoyal101/adbrain/issues/799)).

## Not Now

- Lead-form work beyond keeping it working (WhatsApp is the channel).
- Any automated WhatsApp message to customers beyond the owner's saved template.
- TikTok (no lawful path for an Indian business), video ads, agency or team accounts, and paid ads for AdBrain itself before 3 case studies.
- The 2-Tier managed-account code: frozen, and removed by November 30, 2026 if no customer uses it ([#1171](https://github.com/vanshulgoyal101/adbrain/issues/1171)).
