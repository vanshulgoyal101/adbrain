# AdBrain Identity

This reference describes the existing product identity, not a redesign or proof
of deployment. Use it when adding a screen, changing icons, or reviewing public
metadata. Source baseline: `672eb13`. Product behavior belongs in
[Features](product/README.md).

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

The system is "calm by default" (#847): only the customer's ads and their money are loud; everything
else is ink on white, says one thing once and leads to one next step.

[Global CSS](../src/app/globals.css) imports the locally packaged DM Sans Variable font for body and
display text; Hindi and Punjabi fall back to the phone's own Devanagari and Gurmukhi faces (no
download), all in one `--font-sans` stack. Text marked `lang="hi"`, `"mr"` or `"pa"` gets taller
lines at every size (1.65 body, 1.55 section, 1.4 titles) so vowel signs never touch the next line;
each translated screen marks its own Hindi part, so English left in it is still read as English (#1503).
App type uses five sizes: 13 meta, 15 body, 17 section, 24 page title, 32 figures
(`text-xs`, `text-sm`/`text-base`, `text-lg`/`text-xl`, `text-2xl`/`text-3xl`, `text-4xl`), and three
weights (400, 500, 600). The marketing hero alone is larger. No all-caps labels, eyebrows, numbered
markers on things that aren't a sequence, or trailing arrows on buttons.

| Token | Value | Purpose |
| --- | --- | --- |
| `--foreground` (ink) | `#1b2420` | Text |
| `--muted` (ink-2) | `#5a6660` | Secondary text |
| `slate-400` (ink-3) | `#687370` | Meta and placeholders only |
| `--border` (line) | `#e2e6df` | Every border, 1 px |
| `--background` / `--surface-subtle` (canvas) | `#f6f7f4` | Sidebar, inset strips |
| `--card` | `#ffffff` | Page and surfaces |
| `--primary` (leaf) / `--primary-hover` | `#13784a` / `#0f6440` | The one action colour; link text |
| `--lime-wash` | `#e8f6cf` | A selected ad |
| `--warning` | `#a15c07` | Needs review |
| `--danger` | `#b42318` | Errors |

Status is a dot plus a word in sentence case (Live, Paused, Needs review, Failed); Paused is neutral.
Surfaces are flat: a 1 px line and no shadow, radius 10 (8 for small insets); only menus, dialogs
and sticky bars cast a shadow. A card is an object (an ad or a campaign), never a card inside a card.
The [Button](../src/components/ui/button.tsx) is 44 px (36 px `sm` for desktop tables); one primary
per view, and a disabled primary turns grey. At most one banner per screen, only when something
blocks the primary action. The app frame ([workspace shell](../src/components/workspace-shell.tsx))
uses the same tokens: a canvas sidebar with "Create ads" in the navigation on desktop, and a top bar
with the page name and a 44 px "+" on phones.
Every modal uses [Dialog](../src/components/ui/dialog.tsx) (shadcn/ui on Radix, #403 S6): it
traps focus, closes on Escape or outside click, returns focus to whatever opened it, locks page
scroll and hides the page from screen readers. A bottom sheet on phones, centred from `sm`; give it
a `DialogTitle` and a 44px `DialogClose` with an `aria-label`.
Row and card actions beyond the main one or two go in one 44px "More"
[DropdownMenu](../src/components/ui/dropdown-menu.tsx) (Radix): name the trigger after its row
("More actions for …"), keep items 44px, use `asChild` with `<a>` for links and
`variant="danger"` for destructive items.
Reuse Lucide icons and accessible names for controls; disabled, busy and failed
states must remain distinguishable without relying only on color.

## Language and Workflow

Use the application's terms: Your business, Create ads, Review, Campaigns and
Enquiries; an ad, never a creative; an enquiry, never a lead. Keep copy short and tied to the current task. Distinguish saved,
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
| [icon.svg](../public/icon.svg) | White mark on the leaf browser background |
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
desktop/mobile surfaces under the [Testing](team/testing.md) isolation rules.
