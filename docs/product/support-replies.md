# Support replies

Part of [Features and workflows](README.md).

For whoever answers the pilot's support WhatsApp. Each section has a reply you can paste.
Never ask the owner for a password, OTP or card number; we never need them.

Before you reply, ask for a screenshot if the owner hasn't sent one. The screen's
exact words tell you which section below fits. The full walk is in
[Your first ad on a phone](first-ad.md); results and pausing are in
[Manage](manage.md); approving ads is in [Review](review.md).

## 1. Fewer than 3 ads were made

- **Owner says:** "Only 2 ads came", "it says couldn't be made", "nothing came".
- **Screen shows:** "1 ad couldn't be made." with "Make another"; or, with no ads,
  "We couldn't make your ads this time." with "Try again". Sometimes "Your ads are
  still being made. Check again in a minute; we won't start another batch." with
  "Check again".
- **Cause:** a writing or picture service was busy, so one or more ads didn't finish.
- **Reply:**

  > No problem, nothing was spent. Wait one minute, then tap "Make another" (or "Try
  > again"). If it says your ads are still being made, wait a minute and tap "Check
  > again". You can also continue with the ads you have.

## 2. The picture is slow or doesn't come

- **Owner says:** "Stuck on making pictures", "the picture didn't come", "very slow".
- **Screen shows:** "Making the pictures…" for a long time ("Usually about a
  minute"). In Create you may see "This picture couldn't be made: AdBrain's paid
  image credit has run out and the free image model is busy. Try again in a few
  minutes." or "This ad needs our paid pictures to draw your product, and they're paused
  right now. Add a photo of your product in Brand and AdBrain uses it in the ad as it
  is." When redrawing one picture: "Couldn't redraw the
  picture. Try again."
- **Cause:** pictures come from free picture services that are sometimes busy.
- **Reply:**

  > The picture services are busy right now. Please wait a few minutes and tap "Try
  > again". Nothing is charged for this. If it still doesn't come, send me a
  > screenshot and I'll check.

Tell the CTO on the issue if many owners report this in the same hour.

## 3. Facebook (Meta) won't connect

- **Owner says:** "Facebook says the app isn't available", "connect not working",
  "it keeps asking again".
- **Screen shows:** on the Go live step, under "Facebook Page": "Not connected" and
  "Facebook is still reviewing AdBrain. Until then, your Facebook account needs our
  invite: open your invites and accept adBrain, then tap Connect." with "Open my
  invites". After a failed try: "Didn't connect? If Facebook said the app isn't
  available, accept the invite first, then try again." If the Meta window was closed
  early: "Meta has not finished yet. Complete the Meta window, then check again.
  Your draft is saved." In Settings: "That connection link expired. Please try
  connecting again." or "You declined the permissions AdBrain needs to manage ads."
- **Cause:** until Facebook approves AdBrain, only invited Facebook accounts can
  connect; or the Meta window was closed before the last step.
- **Reply:**

  > Facebook is still checking our app, so you need our invite first. On the Go live
  > screen tap "Open my invites", accept adBrain, then come back and tap "Connect
  > Facebook Page". In the Meta window pick your Page and ad account and go to the
  > end. If it still fails, send me a screenshot.

If the owner has no invite to accept, the invite was not sent to their Facebook
account yet: tell the CEO on GitHub (label `waiting-owner`) so it gets sent.

If the screen says "This ad account is not active. Check Account quality in Meta.",
reply: "Meta has limited this ad account. Open Account quality in Meta and follow
their steps, or connect a different ad account."

## 4. No way to pay on Meta

- **Owner says:** "Payment failed", "it says Meta needs a way to pay", "I only have UPI".
- **Screen shows:** "Payment on Meta": "Add a card, or pay by UPI or net banking" with
  "Add payment in Meta". After tapping Go live: "Meta needs a way to pay first: a
  card, or money added by UPI or net banking. Add it in Meta, then tap Go live
  again. Nothing was spent."
- **Cause:** the Meta ad account has no card and no prepaid money yet (Meta's
  `BILLING_REQUIRED`).
- **Reply:**

  > Meta needs a way to pay before ads can start. Nothing was spent. Tap "Add payment
  > in Meta". A card is charged after the ads run. With UPI or net banking, add money
  > first: at least the "Stops at" amount on the Go live screen, or the ads stop when
  > it runs out. Then come back and tap Go live again.

Never take card or UPI details on WhatsApp. The owner enters them only on Meta.

## 5. Meta rejected an ad

- **Owner says:** "Meta rejected my ad", "ad not approved".
- **Screen shows:** on Home or Campaigns: "Ads Meta didn't approve" and "Meta didn't
  approve your ad.", then one line with the reason, for example "The headline reads
  like clickbait to Meta." or "People who tap can't reach you: the WhatsApp number
  or link isn't working." If Meta gave no clear reason: "Meta didn't say exactly
  why. Here's their message: …". Under it is the fix for that reason, for example
  "Edit the words", "Make a new picture", "Check your WhatsApp number" or "Ask Meta
  to review again" (this opens Meta Ads Manager). Often also "Nothing was spent."
- **Cause:** Meta's reviewers found something against their ad rules.
- **Reply:**

  > Meta didn't approve this ad, and the reason is written on the card. Tap "Edit
  > the words" or "Make a new picture" to fix what it says. If you think Meta got it
  > wrong, tap "Ask Meta to review again" and ask for a review in Meta.

If the reason is "Ads for property, loans or jobs need a special Meta setting
AdBrain doesn't support yet." or "Meta doesn't allow ads for this product or
service.", don't promise a fix: tell the owner honestly and label the issue
`owner:cto`.

## 6. No enquiries yet

- **Owner says:** "Ads are live but no one messaged", "no enquiries", "is it working?".
- **Screen shows:** on Home, "Not showing yet" with "Meta checks your ads first. This
  usually takes a few hours, sometimes up to a day."; later "No chats yet" or "No
  enquiries yet". After a full day unseen: "Your ads haven't started showing after
  a day. Check what Meta says." with "See Meta's status".
- **Cause:** Meta reviews new ads first, and a new campaign often starts slowly; a
  small daily budget reaches fewer people.
- **Reply:**

  > Your ads are live. Meta checks new ads first, which takes a few hours, sometimes
  > up to a day. The first days are often slower.
  > Many people message in the evening. When chats come, they reach you straight on
  > WhatsApp, so please reply fast.

If Home says the ads haven't started after a day, ask for a screenshot of "See
Meta's status" and check for a rejection (section 5) or payment (section 4).
Once chats come, send them [Answer the chats your ad brings](answer-chats.md).

## 7. The sign-in link doesn't work

- **Owner says:** "The link isn't opening", "it says expired".
- **Screen shows:** "This sign-in link has expired" ("Each link works once and only
  for a short time. We'll send you a fresh one.") with "Send a new link"; or "This
  link opened in a different browser" ("Open it in the browser where you asked for
  it, or get a new link here."). Sending can fail with "Could not send a sign-in
  link. Please try again."
- **Cause:** each email link works once, for a short time, in the same browser.
- **Reply:**

  > Each sign-in link works once, for a short time. Tap "Send a new link" and open
  > the new email on the same phone. Or tap "Continue with Google" if you use Gmail.

## 8. Review won't let me launch

- **Owner says:** "It won't send to Meta", "red message on Review", "says fix this first".
- **Screen shows:** on Review, a message with a fix button under it, such as
  "Set the city radius between 17 and 80 km; Meta allows nothing outside that range."
  with "Set the city radius".
- **Cause:** a check that Meta would fail. Nothing was sent and nothing was spent.
- **Reply:** find the message in [When Review stops you](review.md#when-review-stops-you)
  and paste its "What to do" line, then:

  > Tap the button under the message, fix that one thing, then tap "Check again".
  > Nothing has been sent to Meta or spent yet.

## 9. What does Costly (or Early days) mean?

- **Owner says:** "It says Costly", "what does Early days mean?", "is About average bad?".
- **Screen shows:** next to the campaign on Home, or on its card: "Costly", "Early days",
  "About average", "Working", "No chats yet" or "No enquiries yet". With "Costly" the card
  offers "Try new ads", or, when one ad is the problem, "Pause this ad" and "Keep".
- **Cause:** AdBrain compares the cost per chat or enquiry with the usual cost, using fixed
  rules. Every word and its button is in [What your campaign card says](manage.md#what-your-campaign-card-says).
  "Not showing yet" is section 6.
- **Reply:**

  > "Early days" means it's too soon to judge, so let it run and reply to every chat fast.
  > "Costly" means each chat costs much more than usual. If it names one ad, tap "Pause
  > this ad"; otherwise tap "Try new ads". Nothing changes your budget on its own.

## 10. My ads stopped

- **Owner says:** "My ads stopped", "who paused my campaign?", "it says Paused but I didn't".
- **Screen shows:** the card says "Paused" (or "Ended") with "Resume"; Home's Recent
  activity says why, for example "Campaign paused: its run reached the end date".
- **Cause:** one of four: the weekly cap was reached, this week's spend couldn't be
  checked, the AdBrain balance needs a check, or the run reached its end date. Each one,
  with what to do, is in [Why AdBrain paused your campaign](manage.md#why-adbrain-paused-your-campaign).
  Ask whether the run had an end date and whether a weekly cap is set in Settings.
- **Reply:**

  > AdBrain paused it to protect your money: either your weekly cap was reached, or the
  > run reached the end date you chose. Nothing more is spending. To run again, tap
  > "Resume" on the campaign and choose how many days, or raise your weekly cap in
  > Settings first.

## Still stuck

Ask for a screenshot and the time it happened, then open or update the GitHub issue
with what the screen said. Keep customer names and phone numbers out of GitHub
(the repo is public); put them in `vbrain-private` and use an opaque key.
