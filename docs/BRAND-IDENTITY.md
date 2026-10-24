# AdBrain Identity

This reference describes the existing product identity, not a redesign or proof
of deployment. Use it when adding a screen, changing icons, or reviewing public
metadata. Source baseline: `672eb13`. Product behavior belongs in
[Features](FEATURES.md).

## Name and Mark

Write the product name **AdBrain**. The canonical mark is the installed
`lucide-react` `Brain` component, used by
[the asset generator](../scripts/generate-icons.mjs). Reuse its geometry for
login, navigation, legal and recovery surfaces; do not substitute a monogram or
another drawing. Body-copy mentions and page titles remain searchable text.

Keep the logo distinct from customer branding. A customer's approved ad artwork,
logo or brand colors do not change AdBrain's application identity. Do not use
an operator's Meta account identity as the product's legal identity; the current
operator and future arrangements are documented in [Payments](PAYMENTS-PLAN.md).

## Typography and Color

[Global CSS](../src/app/globals.css) imports the locally packaged DM Sans
Variable font. Both body and display text use that family; code uses the existing
monospace stack. Reuse the tokens and shared primitives rather than introducing
another font, theme or isolated palette.

| Token | Current value | Purpose |
| --- | --- | --- |
| `--background` | `#f6f7f9` | Application background |
| `--foreground` | `#24292e` | Default text |
| `--card` | `#ffffff` | Framed surfaces |
| `--border` | `#e1e5e9` | Separators |
| `--muted` | `#67727d` | Secondary information |
| `--primary` | `#2563eb` | Primary brand/action blue |
| `--accent` | `#d97706` | Accent amber |
| `--focus-ring` | `#7ca0ff` | Global focus token |

The [Button](../src/components/ui/button.tsx) has primary, secondary, outline,
ghost and danger variants, fixed 32/40/48px heights, normal tracking and visible
keyboard focus. The [Card](../src/components/ui/card.tsx) uses the existing
rounded-lg white bordered surface; its Badge is pill-shaped. Follow the actual
component defaults rather than assuming every element uses the same radius.
Every modal uses [Dialog](../src/components/ui/dialog.tsx) (shadcn/ui on Radix, #403 S6): it
traps focus, closes on Escape or outside click, returns focus to whatever opened it, locks page
scroll and hides the page from screen readers. A bottom sheet on phones, centred from `sm`; give it
a `DialogTitle` and a 44px `DialogClose` with an `aria-label`.
Reuse Lucide icons and accessible names for controls; disabled, busy and failed
states must remain distinguishable without relying only on color.

## Language and Workflow

Use the application's terms: Brand Brain, Create, Review, Campaigns and
Enquiries. Keep copy short and tied to the current task. Distinguish saved,
approved, paused, active, partial and failed states accurately: a saved creative
is not a published ad, and a completed test payment is not advertising credit.
Never promise leads, revenue, provider consent or live payment capability based
on a mock or feature branch. See [the documentation terminology](README.md#terminology).

## Generated assets

`npm run generate:icons` renders the Brain component and **overwrites local
generated assets**. It does not publish them. Run it only for an intended icon
change, not to validate prose. Review generated diffs together with the generator.

| Output | Use |
| --- | --- |
| [logo.svg](../public/logo.svg) | Transparent monochrome geometry |
| [icon.svg](../public/icon.svg) | White mark on blue browser background |
| [favicon.ico](../public/favicon.ico) | 16/32/48px frames |
| [icon-192.png](../public/icon-192.png), [icon-512.png](../public/icon-512.png) | Install icons |
| [apple-icon-180.png](../public/apple-icon-180.png) | Apple touch icon |
| [maskable-512.png](../public/maskable-512.png) | Full-bleed background and inset safe geometry |

[Layout metadata](../src/app/layout.tsx) and
[the web manifest](../src/app/manifest.ts) reference versioned assets. Existing
installed apps and third-party caches can refresh asynchronously; compare the
actual requested URL and served bytes before diagnosing an outdated icon.

[The social-image renderer](../src/app/opengraph-image.tsx) embeds the generated
192px PNG instead of invoking the client-marked Lucide component. Preserve that
server-compatible boundary and inspect the raster output when changing it.

## Product family

Check the mark with the repository-local [icon tests](../tests/icons.test.ts). Do not
alter sibling sites or their favicons as an incidental AdBrain change.

## Release checks

For documentation-only changes, run `npm run docs:check`; do not regenerate
assets or replay browser/provider suites. For an actual brand change, run the
affected icon tests and required CI, then inspect favicon, social raster and
desktop/mobile surfaces under the [Testing](TESTING.md) isolation rules.
