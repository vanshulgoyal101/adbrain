# AI Pipeline: Variant Generation

Part of [Architecture](README.md). [Interview and boundaries](ai-pipeline.md) · [Variant generation](ai-pipeline-variants.md) · [Routing, images and cost](ai-pipeline-routing.md).

## Variant Generation

1. Bound the context: brief 2000 characters, selected brand strings 1000 each,
    lists at most ten items, active instruction text at most 3000 characters.
    When enabled, read up to five relevant declared preferences for this owner
    and business; pass at most 1200 advisory characters separately to concept
    and image prompts. Current brief/instructions and Brand facts take priority.
2. Choose up to six configured marketing angles; default batch count is three.
3. For each angle, request a structured concept with caching disabled. First
   attempt temperature is 0.8; one repair attempt uses 0.4 and is told each
   failed check, with the actual length when text is too long (#281). The repair sees its own
   draft and rewrites only what failed when the failures are about form (#2444); a reply that wasn't JSON, or a
   draft that broke a fact or policy rule, gets a fresh try. Max output and
   reasoning effort are configured. Failed validation stops the variant.
   Before validation, cosmetic slips are normalized once:
   - Over-long `visual.medium`, `visual.direction` and rationale are clipped at a word. An over-long link
     description is cut back to its last full sentence ('Rs.', 'Dr.' and similar don't count), else its last clause
     if that keeps half the limit; with neither it fails and the repair rewrites it, never mid-thought (#1544).
   - Case and spacing variants of a CTA or `textPlacement` are mapped, and `left` becomes `center`.
   - An empty or over-long `supportingText` becomes null, and empty quotes are dropped.
   - A quote that differs from a fact only in case is stored as the fact's exact text.
   - A quote that only adds a leading "the", "a" or "an" to a fact (20+ characters after it) is
     stored as the fact's own words (#713).
   - A quote that matches no fact is dropped when at least one other quote does;
     claims are then checked against the remaining quotes, and a concept with no
     verbatim quote is still refused (#713).
   - Any primary-text line over 125 characters is split into sentence lines
     (words unchanged), because Meta shows about 125 characters on mobile before
     "See more" (#194, #713).

   Headline and primary text are never clipped, and every claim check still runs.
   In `visual.direction`, layout notes such as "55% of the frame height", "45%
   opacity" and "free of detail" are not read as offers (#202); a price, "20% off"
   or "FREE" shown in the visual still needs a supporting fact. A cited "₹10,000"
   is supported by a quote saying "10,000 rupees" or "Rs 10000", the same match
   the interview uses (#284, #281). An offer the copy states without citing it is cited
   automatically with the one supplied fact that contains it (#281): an amount or percentage
   by its token, and "free", "no-cost" or "guarantee" only when the thing offered (the next
   words) is in that fact too, so "FREE consultation" is not cited by "Free 15-minute spine
   check". No match or several matches leave it uncited and rejected. "No-cost" counts as
   "free", and a negated term ("not a guaranteed saving", "no guarantee", "गारंटी नहीं") is not a
   claim; "not just free installation" still is (#378). The interview's claim check follows
   the same two rules.
   A first line over 125 characters (`hook-length`) or an offer (price, %, free)
   that starts after character 125 (`offer-below-fold`) is repaired once like any
   other validation failure. An amount in words leading the first line ("10,000
   rupaye per kW") counts like the same amount in ₹. `all-caps` ignores acronyms
   joined by "/" or "-" ("IIT/PEC", "नॉन-DCR") and capitals the owner's own facts use
   (a brand written "SOLARIDE") (#418).
   A price the Brand facts give only as a rate ("10,000 rupees per kilowatt") must keep
   that unit in the ad (`price-unit`; kW, kilowatt and किलोवाट count as one); a flat
   Brand price may be worded freely (#418 rule 3).
   Once a concept passes, the offer goes on the picture (#418 rule 2): when the copy
   states a cited offer that neither the headline nor `supportingText` carries,
   `supportingText` becomes the one Brand offer fact (up to 64 characters) that states
   it. No repair and no new words; Hindi and Punjabi copy keeps its own picture line.
4. Generate an image from the validated concept and up to three reference images.
   When the business has uploaded product photos (Brand assets), ads 1 to
   min(k, 3) each use a different one, newest first (#195, #1901); a retried ad keeps
   its own photo. The rest get generated images. An owner-photo ad makes no image call and has no image cost,
   its concept is told the image is the owner's unseen photo, and the receipt
   records `ownerPhoto`. If that photo can't be downloaded or validated, the ad
   gets a generated image as usual.
   The renderer fits every background to the ad's exact frame first
   (`fitPhoto`, #1904): EXIF orientation, then sharp's `attention` saliency crop
   so a phone photo's face isn't cut off, or `backgroundFit: "blur"` (the whole
   photo on a blurred copy of itself) for group shots.
   An owner photo's words always go along the bottom (`OWNER_PHOTO_LAYOUT`, #2430), at
   Create, on a borrowed sibling photo and when the owner switches an ad to their own photo:
   the concept picks `textPlacement` without seeing the photo, and real photos put faces
   on the upper third. AI pictures keep the concept's placement, which their prompt keeps quiet.
5. Download and validate the raster, persist the source image, render the designed
   poster when enabled, persist the final image, then insert a draft creative row.
   The poster's contact bar asks for a WhatsApp message (chat icon, no number) for a business whose
   campaigns open WhatsApp: an India-based phone (#235) or a saved WhatsApp message (`contactChannel`,
   #1147). The ask is in the ad's language ("Message us on WhatsApp", "WhatsApp पर मैसेज करें",
   "WhatsApp par message karein", "WhatsApp ਤੇ ਮੈਸੇਜ ਕਰੋ"; Indic words shaped like the rest, #1177).
   Others show their phone number, as do designs saved before #1147. A WhatsApp business's concept
   gets no phone or email and is told its button opens a chat; when the copy's last line doesn't mention
   WhatsApp, that same ask is added as the last line, in the ad's language ($0, no repair). Review warns, without
   blocking, when such a picture goes to a form campaign, and offers "Switch to WhatsApp".
6. Save usage receipts and report partial failures independently of successful rows.

Variants run concurrently using `Promise.allSettled` with a shared 240-second
generation signal. POST route duration is 300 seconds. These are implementation
budgets, not an SLA: persistence has its own calls and hosting limits still apply.
The batch is not automatically cancelled merely because a browser stopped waiting.

`CreativeValidationError` retains usage from invalid concepts; image failure also
retains preceding text usage. The #54 prevention candidate records each text and
image provider attempt on success, fallback and failure, including a bounded
provider request ID where returned and completed/unknown finality. The generation
UUID stays separate from the HTTP request ID. Missing IDs or zero-token error
receipts do not prove a provider charged nothing or completed no work. Provider
errors are returned as safe user-facing failures, not raw prompt/token traces. No model validation proves the image
accurately depicts a real product or that an ad claim is legally supportable.
Preferences are style guidance, not evidence for `sourceQuotes` or commercial
claims and not permission to spend. The brief is direction, not quote evidence:
Create passes only the original user goal and free-text answers as explicit
`sourceFacts`; model-suggested options and the interview brief are excluded.
Studio passes its directly authored brief as evidence. Validated user facts are
saved in the generation receipt for regeneration and fenced by the generation ID;
older receipts without facts use Brand fields and saved instructions only.
Review or edits to a generated brief alone do not certify its claims; add new
facts to the goal/answers or write a direct Studio brief instead. Paused, forgotten, fresh-direction and
unavailable memory supply no advisory text. A read failure omits notes without
changing admission, replay, usage accounting or the unresolved-intent hold.
When notes are used for an image, the saved image-prompt receipt contains only
an omission marker, not a provider prompt or a prompt reconstructed from the
concept. The validated concept, copy and finished image can still echo advisory
style; no deterministic filter can distinguish identical user art direction from
model-echoed memory. An in-flight paid request cannot retract context already
sent to a provider after a later forget; older creative output may still reflect
the guidance.

### Recover a Lost Response

[Studio](../../src/components/studio.tsx) stores a generation UUID and count in local
storage before POST. On reload or an unconfirmed response it calls the generation
GET with that UUID/count and shows saved rows before allowing a new request; it
clears the stored intent only after saved creatives, `complete`, `failed`, 404 or
a definitive 4xx rejection. Repeating POST with the same UUID returns 202 without starting another
producer. `processing` does not prove a worker is alive, and `unresolved` needs
investigation rather than another paid request. Exact statuses are in
[Generate and Recover](../api/creatives.md#generate-and-recover).

### Product References

[Reference selection](../../src/lib/creative/references.ts) reads the latest 12
`product_photo`/`past_ad` assets, prioritizes product photos, and uses at most
three. Logo assets are not selected as product references; logo composition is
separate. A reference lookup failure stops generation rather than silently
omitting a paid input. Reference URLs and media are provided to the selected
image provider; account for this in consent and data handling.

Pollinations rejects reference images. Selecting it with saved product references
can fail unless an explicitly configured compatible fallback succeeds. Reference
support and asset fidelity are provider-specific, not guaranteed by the interface.

### Formats and Languages

| Format | Final design dimensions |
| --- | --- |
| `portrait` (default) | 1080 x 1350 |
| `square` | 1080 x 1080 |
| `story` | 1080 x 1920 |
| `landscape` | 1200 x 628 |

Dimensions come from [AD_FORMATS](../../src/lib/creative/design.ts). Image providers
may generate a different source raster before the compositor fits the final
design; do not confuse source dimensions with final placement dimensions.

[Language IDs](../../src/lib/languages.ts): `brand`, `en`, `hinglish`, `hi`, `pa`,
`pa_roman`. Unknown generation language IDs normalize to brand-default guidance.
Interview output validates its language choice against the supported list.
Create offers `en`, `hinglish`, `hi` and `pa` (#290). The interview detects whether
the owner writes Devanagari Hindi, Gurmukhi Punjabi or Roman-script Hindi, tells the
model to ask in it (`OWNER WRITES IN`), and suggests that ad language when the model
leaves `language` out. Hindi or Punjabi copy can go on the image too (`headline`,
`supportingText`); the compositor shapes it (#300). The claim check reads
"फ्री"/"मुफ़्त"/"ਮੁਫ਼ਤ" as free, "गारंटी" as guarantee and "रुपये"/"rupaye" as rupees, and a
quote with "नहीं" or "बिना" doesn't back a claim.
Font coverage and language quality still need visual/human review.

### Raster and Composition Rules

The shared downloader accepts only validated, single-frame PNG/JPEG/WebP, limits
input and normalized output to 20 MiB, limits decoding to 40 million pixels,
applies orientation, and normalizes to PNG. It bounds streamed bytes even when
Content-Length is absent or false. HTTP media downloads use safe public URL/DNS
and redirect handling; inline data URIs are base64 raster-only.

The design spec contains brand lockup, headline/subhead, up to four benefits,
the Brand phone (drawn large and bold with a call icon), a small contact line
(website and first service area), CTA, colors, font, and angle-specific
top/center/bottom placement. A subhead that states an offer (a ₹ price, "free …",
"% off", a flat discount; `isOfferLine` in [ad-composite](../../src/lib/creative/ad-composite.tsx))
is drawn as a bold strip in the brand colour, as long-running local ads do (#967);
any other subhead stays a quiet grey line. The editor preview uses the same composite.
The [renderer](../../src/lib/creative/render.tsx) receives validated inline media.
It draws all text in Inter 400/600/700/800 ([fonts](../../src/lib/creative/fonts/),
OFL), so headlines are really bold; the brand's sans/serif/mono choice falls
back to Inter. Words in Devanagari or Gurmukhi (brand, headline, subhead,
benefits, contact line) are shaped by [sharp/Pango](../../src/lib/creative/shaped-text.ts)
with Noto Sans Devanagari/Gurmukhi (OFL) and drawn as an image in their place,
because Satori misplaces vowel signs.
With overlay enabled, render/persistence failure fails the variant: **there is
no implicit bare-photo success fallback**. `AD_DESIGN_OVERLAY=false` explicitly
chooses the source photo. Source uploads can remain if later steps fail.
