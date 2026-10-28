# Brand

Part of [Features and workflows](README.md).

## Brand Brain

Save business name, industry, website, description, voice, audience, languages,
service areas, selling points, offers, brand colors/font/logo, and contact fields.
A website typed as a bare domain is saved as a full `https://` link, shown under the field
as "Ads link to …" (#470). The industry is free text, not a solar-only enum. The reusable fact record drives
copy, image prompts, and campaign audience suggestions.
"Saved" acknowledges only the submitted form revision after a successful save.
Later edits, including edits made while a save is pending, require another save;
failed saves leave the draft available for retry. The full form has no autosave.

Until a business has a campaign that went live (or is on now), `/brand` is setup
step 1 of 3 (#1251 WS1, #1269): the five `brandUsable` fields (name, what you
sell, places one per line, one offer, a 10-digit WhatsApp number) plus "Fill it
from my website", which fills only empty fields. It autosaves only those columns
(`saveSetupBusiness`; other offers and Brand fields are kept) and "Make my ads"
checks all five, then goes to `/create`. `/brand?all=1` opens the full page.

Until then Home (`/dashboard`) is one resume card, "Your first ad · Step N of 3 ·
{step} · Continue" (#1272, `setupResumeStep`): step 1 until the five facts make a
usable Brand, step 2 until an ad is picked (approved), then step 3. At step 3 with ads made
from today's step 1 (`madeForSetup`, e.g. a handed-over prospect account), the card says
"Your N ads are ready", shows up to 3 of them and leads with **Connect and go live** (#1712);
budget, area and payment stay on step 3. The + button
reads "Continue your first ad" and `/create` sends a first-timer without the five
facts to `/brand`. A campaign counts as having gone live once it has `launched_at`
or is active or completed.

Website autofill fetches a public website and proposes extracted facts. On a Brand with
nothing filled in yet it runs by itself when the owner leaves the Website field (once per
address, #1025); otherwise the "Autofill from website" button runs it. It proposes up to 5
service areas the site names (#1037) as Locations chips the owner checks before saving. It does
not prove those claims are true or authorize scraping private pages. The UI
preserves fields edited during extraction, discards a response when the website
changes, and prevents save while extraction is pending. Review suggestions before
saving. Network, validation, extraction, and storage failures are distinct from
an empty brand. After a successful extraction the form lists what it filled and
which key facts are still empty (offers or prices, service areas, phone, audience).
The phone is filled only from an international-format `tel:` link on the page.

Assets have types `logo`, `product_photo`, and `past_ad`. Uploading a logo and
selecting it as the business logo are separate persistence steps. Storage and
database writes are not one transaction: failed row creation attempts file
cleanup; a failed logo assignment is visible; deletion clears matching logo
references and confirms row deletion before file removal. Manual edits are not
silently overwritten by a refresh.

Brand readiness counts six checks, including a logo and at least one real photo
(`product_photo`); unready ones link to the asset section. Create also asks for a
missing logo or photos, linking to `/brand#brand-assets`. Both can be skipped.
Real photos are reference hints for image generation, not the ad image itself.

Instruction files have a title, Markdown body, and active flag. Active instructions
are included by generation/planning call sites; an instruction is guidance to a
model, not deterministic enforcement. Never put credentials or sensitive lead
details in prompts. See [Data Model](../DATA_MODEL.md) and [AI Pipeline](../AI_PIPELINE.md).
