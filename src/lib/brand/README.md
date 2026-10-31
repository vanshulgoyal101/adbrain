# Brand

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module holds the pure rules behind the Brand form, the first setup step and website autofill: parsing, validation, readiness and extraction helpers. It does not read or write the database or fetch anything; the [Brand actions](<../../app/(app)/brand/actions.ts>) save the `businesses` row and the [autofill route](../../app/api/brand/autofill/route.ts) does the fetch and the model call.

## Start here

| File | Owns |
| --- | --- |
| [validation.ts](validation.ts) | Email, phone and URL checks, and `normalizeWebsite` (a bare domain becomes `https://…`) |
| [usable.ts](usable.ts) | `brandUsable`: the five facts a Brand needs before Prepare can use it |
| [setup-fields.ts](setup-fields.ts) | Setup step 1's fields, limits and errors (10-digit Indian mobile, one place per line) |
| [autofill.ts](autofill.ts) | Website and pasted-text extraction helpers and the model call's settings (`BRAND_EXTRACTION`) |
| [meter.ts](meter.ts) | Home's Brand meter: which of offer, proof, why and audience are known, and what to ask next |
| [fields.ts](fields.ts) | Trimming form values into strings and lists |
| [offer.ts](offer.ts) | Shared Brand offer wording for Create and WhatsApp asks |

## Rules

- Keep it pure: no Supabase client and no network call here, so the browser and the server action run the same checks. Tenant ownership is enforced where the row is saved, not in this module.
- The client's inline errors are a convenience; the server action re-runs `validateBrandFields` and `normalizeWebsite` before saving ([validation.ts](validation.ts)).
- The setup step and its save action read the same fields, limits and phone rule from [setup-fields.ts](setup-fields.ts). `brandUsable` ([usable.ts](usable.ts)) is the one definition of the five facts, behind both the `brandUsable` event flag and setup's "step 1 until usable" ([resume.ts](../setup/resume.ts)); change it there, not in a caller.
- Autofill only proposes; the owner reviews before anything is saved. Service areas must be written on the page itself (at most 5, never a whole country), and a phone comes only from an international-format `tel:` link ([autofill.ts](autofill.ts)).
- The meter's proof check reads the same facts as preflight's proof warning (selling points and description), through `proofFacts` in [proof-line.ts](../creative/proof-line.ts) ([meter.ts](meter.ts)).
- Fonts are limited to the families the poster renderer can draw; unknown stored values fall back to sans-serif ([fonts.ts](fonts.ts)).

## Tests

- [Brand autofill (core)](../../../tests/core/brand-autofill.test.ts), [autofill route](../../../tests/brand-autofill-route.test.ts), [service areas](../../../tests/brand-autofill-areas.test.ts) and [pasted text](../../../tests/brand-pasted-text.test.ts)
- [Setup step (core)](../../../tests/core/setup-business-step.test.tsx) and [brandUsable](../../../tests/brand-usable.test.ts)
- [Brand meter](../../../tests/brand-meter.test.ts), [form fields](../../../tests/brand-fields.test.ts) and [form inputs](../../../tests/brand-inputs.test.tsx)

## More

- [Brand Brain (product)](../../../docs/product/brand.md#brand-brain)
- [Website autofill API](../../../docs/api/creatives.md#website-autofill)
- [Identity and tenant ownership](../../../docs/architecture/overview.md#identity-and-tenant-ownership)
