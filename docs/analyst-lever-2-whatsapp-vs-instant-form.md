# Lever 2 evidence: WhatsApp click-to-chat vs instant form

**Research date:** 2026-10-27  
**Scope:** Indian local services (clinics, solar, coaching). No credible public source found an apples-to-apples India benchmark reporting both destinations as cost per *real* enquiry. Treat vendor claims below as directional, not a forecast.

## Evidence

| Source (date) | What it says | Implication |
|---|---|---|
| [Meta, Lead ads with forms](https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms) (retrieved 2026-10-27; page has no publication date) | Instant forms are mobile-first and auto-populate fields. Meta says advertisers using instant form + website form saw 60% lower CPL than website-only; its quality path is “conversion leads” with CRM/Conversions API. | Forms should minimize the WhatsApp “opened but did not send” leak, but raw CPL is not the same as a valid phone or booked customer. |
| [Meta, Lead ads that click to message](https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-messaging) (retrieved 2026-10-27; page has no publication date) | Click-to-message keeps follow-up in one thread, supports qualifying questions, and Meta reports 62% more leads vs legacy non-Meta channels. Meta recommends clear next steps and says six or fewer questions is usually optimal. | Chat can produce richer intent and qualification, but only when the person sends a message and the business follows up promptly; Meta does not publish an India WhatsApp cost-per-real-enquiry benchmark here. |
| AdBrain #157 ledger/comment (read 2026-10-27; run data dated 2026-10-26) | Solaride WhatsApp: ₹820 spend, 94 WhatsApp opens, 5 chats: **₹164/chat** and 5.3% open-to-chat. | This is a local solar baseline, not a general benchmark; the dominant cost leak is non-senders. |
| AdBrain #499 ledger/comment (read 2026-10-27; ~22-hour read dated 2026-10-27) | Solaride WhatsApp: ₹291 spend, 23 opens, 1 chat: **₹291/chat** and 4.3% open-to-chat. | Direction agrees with #157 but sample is tiny; do not pool as a stable rate. |
| AdBrain #680 acceptance rule (2026-10-27) | Compare same audience, budget, placements and creative; primary metric is real enquiries, with a valid Indian mobile required for lead-form quality. | The only reliable answer for this account is a controlled A/B, not a published CPL claim. |

## Decision for the lever-2 run

Run instant form against WhatsApp with identical creative, audience, placements and budget. Report **₹ per valid enquiry** (and downstream contacted/qualified rate), not Meta-reported lead or WhatsApp-open cost. Keep the WhatsApp arm only if its qualified-enquiry rate offsets its observed 94–95% open-to-send loss; otherwise use the form as the default acquisition destination and retain chat for qualification after capture. The existing #680 rule (at least 40 taps per arm and a repeat if the result is not decisive) is appropriate.
