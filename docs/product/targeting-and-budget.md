# Campaign Targeting and Budget

Part of [Features and workflows](README.md). Step of [Prepare a Campaign](launch.md#prepare-a-campaign).

### Targeting and Budget

- New ad sets use Meta's Advantage+ audience (#334). The area and its exclusions
  are hard limits. Meta caps a hard minimum age at 25 and fixes the maximum at 65,
  so the owner's age range is sent as an `age_range` suggestion; gender and
  interests are suggestions too. The review says: "Meta may reach people beyond your
  age range and interests; never outside your area." Campaigns already launched
  keep their original targeting.
- **Edit ad words** (#775): a paused or running AdBrain campaign's More menu changes an ad's
  headline, text or description. Meta gets a new version of the ad (picture, 9:16 and WhatsApp
  message kept), the ad goes back to review, and nothing else changes. Same claim checks as Studio.
- A business's saved WhatsApp message (`businesses.whatsapp_template`, #840) is what every
  new WhatsApp campaign sends: the welcome, then a pre-typed message (optionally with a Call
  now button) or up to 3 questions. A campaign's own edit (draft `whatsappMessage`) wins over
  it, with the same claim checks as a blocker. With neither, AdBrain writes the greeting and
  prefill per campaign as before. Review returns the exact message (`whatsappMessage`) and
  launch sends that one; an edited or saved message is part of the plan hash. The ledger
  records the button and whether it was edited, saved or suggested. In the composer,
  "WhatsApp message: Your saved message · Edit for this campaign" opens the same fields and
  preview ("Also save as my message" is off by default); Review's "When they tap" shows the
  message in one line and a preview, with a soft note when its language differs from the ads.
  #1081: it also shows the business's past open → message rate across its WhatsApp campaigns
  (from 10 opens), and a soft note when the pre-typed ask names no offer or number ("Hi, I want
  info"); neither blocks the send (`src/lib/campaign/whatsapp-handoff.ts`).
  With Quick questions there is no pre-typed message, so AdBrain's own welcome reads "…Tap a question
  below and we'll reply here." (all 4 languages; Brand card, composer and launch alike, #1121); a
  welcome the owner typed is never changed.
  Choosing "Quick questions" on Brand, or in Review's "Edit for this campaign", fills the empty
  boxes with 3 suggestions from the Brand (`src/lib/campaign/whatsapp-questions.ts`, #905, #1114):
  up to 2 offers asked as a customer would, in the owner's words ("Can I book a free site survey?",
  "Can I get PM Surya Ghar subsidy help?"; Hinglish "… book ho sakta hai?" / "… kaise milega?",
  Hindi and Punjabi alike), then "What's the price?" or "Call me back". A labelled offer is asked by
  the words after its label; when the question would pass 40 characters it asks for the offer's first
  item with its price ("Can I get the $49 new-patient exam?"), else the offer itself as a question
  ("Check-up and cleaning for ₹499?"); one that still doesn't fit is skipped, never cut mid-claim. A free offer is booked,
  never asked as a cost. They are only suggestions: nothing is sent until the owner saves (or uses
  them for the campaign), and saving runs the claim check.
  #418 rule 7: when every ad's last line quotes the words to send ('WhatsApp “Free site survey” to
  book'), AdBrain's suggested pre-typed message is exactly those words (`quotedAsk`). When an ad
  quotes other words than the message WhatsApp will pre-type (a saved or edited one), Review warns
  (never blocks): "An ad asks customers to send “…”, but WhatsApp pre-types “…”".
  With Quick questions on there is no pre-typed message, so an ad that quotes one gets one warning
  instead (#1198): "Your ad promises a ready message, but customers will see quick questions…", with
  **Change the last line**: one tap rewrites each quoting ad's last line, in the ad's own language, to "Tap, then pick a question
  to send." (approval unchanged) and checks the campaign again.
  #418 rule 5: when the Brand has proof (years in business, jobs done, a named credential or a
  warranty; `src/lib/creative/proof-line.ts`) and none of the chosen ads cites it, Review warns
  (never blocks) and names one ("None of these ads has a proof line from your Brand…").
- Every Indian ad set also excludes everything outside the service area (#741):
  every state/UT with no included place (Tricity: all but Chandigarh, Punjab and
  Haryana), plus the larger cities in the kept states that lie further than the
  included city's radius + 30 km (Ludhiana, Amritsar, Ambala, Gurugram…); a state
  included as a whole keeps all its cities (#804). Places are matched
  by Meta key (`src/lib/meta/service-area.ts`); the owner's own exclusions are kept.
  If Meta can't describe the area, the launch is refused (`TARGETING_EXCLUSIONS_MISSING`),
  and a tree built before the rule can't be activated. With Advantage+ audience and
  interests, Meta refuses later targeting edits, so exclusions must be in the create;
  a targeting edit on a live ad set restarts ad review (about 5 minutes on #157).
  Country-wide and non-Indian areas get no automatic exclusions.
- Typed area names resolve in the business's country (India; #1555): a name whose only Meta
  match is abroad comes back unresolved ("Meta didn't recognise the area…") unless the owner typed
  its qualified label ("Austin, Texas"). Everyday Tricity names Meta has no place for search the
  places it has (`src/lib/meta/geo-aliases.ts`, #1556): Tricity and Zirakpur → Chandigarh, Mohali,
  Panchkula; Derabassi → Dera Bassi; New Chandigarh, Aerocity → Mohali; 'Sector N'/'Phase N' with
  a city → that city (a bare 'Sector 17' stays unresolved). Meta's only 'Tricity' is Tri-City, Oregon.
- Every campaign must have detailed interest targeting before creation. AI plans
  require one to five relevant commercial interests grounded in the business and
  offer. Preparing a draft with missing/empty interests requests AI recommendations
  even when location and age are manual. Existing nonempty suggestions remain
  editable and reusable; saving an incomplete draft does not invoke AI.
- Missing or unresolvable interests block creation rather than silently falling
  back to a broad audience. Meta validates the interest IDs before review and
  creation; each ad set receives them as detailed-targeting signals. This does not
  create custom audiences or guarantee that Meta will never expand delivery beyond
  those signals. Restricted-category and sensitive-trait safeguards still apply.
- Gender can be set to All genders (default), Men, or Women under Audience &
  location. It is saved and restored with the draft, displayed in review, and
  applied to every ad set for both instant-form and WhatsApp campaigns. AI
  audience recommendations preserve the owner's selection; changing it requires
  a fresh review. Older drafts without this field keep All genders. The editor's
  existing special-ad-category restrictions still apply.
- Location and age "Let AdBrain decide" actions request a cancellable audience
  recommendation immediately after creative selection. Returned areas, ages,
  radius, interests, and rationale remain editable; the action does not save or
  create a campaign. Failures retain existing inputs. Budget, creative selection,
  destination, and lead form remain owner-controlled in audience-only planning.
- Location is asked once, in "Where should ads show?" (#305). "Let AdBrain decide"
  shows the decided areas and exclusions as a summary; "Choose myself" holds the
  location search plus the typed planned and excluded areas.
- Planned and excluded area entries use one place per line, preserving commas
  inside names. Manual areas and radius edits are retained; explicitly requesting
  a fresh location decision replaces prior suggested areas. Age-only decisions
  preserve chosen geography. Geographic resolution prefers exact names and
  qualified city/region labels, without assuming India when no country is given.
- Manual location search separates loading, no-match, and failed lookups. Retry
  preserves selected places; editing a query immediately removes stale choices.
  Results show region labels and support arrow-key selection with Enter. Escape,
  Tab, and leaving the picker dismiss results, including late responses.
- Targeting help opens on hover, focus, click, or touch; explanations are linked
  to their triggers for assistive technology. Escape and outside clicks dismiss
  help, and positioning keeps it inside horizontal viewport edges.
- Ages must resolve to explicit bounds between 18 and 65, minimum no greater
  than maximum; Meta's upper endpoint represents its supported 65+ range.
- City coverage offers City only (no added radius) or City + radius. New manual
  drafts default to City only; guided planning defaults to it unless surrounding
  service areas justify a radius. Existing saved drafts without a scope retain
  their radius behavior. The scope applies to both included and excluded cities,
  is preserved during audience recommendations, and is bound to campaign review.
  States and countries are unchanged. City-only payloads send the Meta city key
  without radius/distance units; review blocks a contradictory resolved radius.
  This requests Meta's city area, not a verified municipal-boundary polygon.
  Real-account acceptance and returned coverage must be verified before rollout.
- City + radius requires 17-80 km at preflight. Draft schemas accept 5-80 km so a
  saved legacy/incomplete value can be edited, not so an invalid radius can launch.
- Background audience plan (#366): in Choose settings, 1.5 s after the ads are
  chosen (and the audience still needs AdBrain), the audience is planned in the
  background, at most three times per composer. Prepare uses that reply once if
  the Campaign goal field, ads, targeting and destination are unchanged and it
  succeeded (a name or budget typed later doesn't count); otherwise Prepare stops
  the stale request quietly and plans as before. The reply stays in the browser.
- Up to five interest names and a nonempty rationale can be saved. Meta resolves
  IDs and eligibility; unresolved interests block creation.
- Missing geography does not silently broaden to nationwide. Nationwide must be
  an explicit, reviewable choice.
- Creation requires an INR account and a positive daily budget. API currency
  values are whole rupees; the Meta adapter converts to minor units.
- Optional age-split testing creates two ad sets. A 200-rupee daily input then
  means 400 rupees/day total, not 200 split between them. It is not a randomized
  Meta Experiments A/B test.
- Lead estimates and interest recommendations are heuristics, not delivery or
  conversion guarantees. Restricted-category support is not established by an
  AI declaration check.
