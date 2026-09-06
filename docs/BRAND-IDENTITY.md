# AdBrain Identity

The canonical mark is the installed `lucide-react` Brain icon used by the public
landing page. Use that component for app branding, including login, navigation,
legal pages, and recovery screens. Do not substitute a monogram or another brain
drawing. Body-copy mentions and page titles remain ordinary searchable text.

## Generated assets

`npm run generate:icons` renders that component and produces:

- `public/logo.svg`: transparent, monochrome geometry for line-icon consumers.
- `public/icon.svg`: white mark on a blue background for browser use.
- `public/favicon.ico`: 16/32/48 pixel frames.
- `public/icon-192.png` and `public/icon-512.png`: install icons.
- `public/apple-icon-180.png`: Apple touch icon.
- `public/maskable-512.png`: full-bleed background with inset safe-zone geometry.

The browser metadata references versioned URLs to refresh the previous favicon.
The manifest and JSON-LD reference the generated assets. Existing installed apps
and third-party social caches may refresh asynchronously.

The social image embeds the generated PNG. Next ImageResponse cannot invoke the
client-marked Lucide component; direct component use failed the production build.
Keep the renderer server-compatible and verify the raster output after building.

## Product family

Links embeds the monochrome paths in its existing colored icon slot. Portfolio
stores a local copy of `icon.svg` at `public/images/projects/adbrain-icon.svg`,
used beside the project title and as a fallback. Its primary artwork remains a
real public-page screenshot. Other sites' own favicons and unrelated logos stay
unchanged. Searches found no other live product-logo slots for AdBrain in the
remaining sibling website sources; prose, test fixtures, and metadata references
are not logo slots.

`node scripts/check-brand-parity.mjs` checks exact paths across the three sibling
checkouts. This is a release check, not a runtime dependency. `tests/icons.test.ts`
checks canonical geometry and required icon formats within this repository.

## Release checks

Run lint, typecheck, coverage, production build, and the workspace/browser tests.
For sibling sites run their local tests and required build/browser gates. Inspect
the actual favicon, social raster, and desktop/mobile product cards. Verify each
production deployment's commit plus its served markup and asset bytes. Do not
equate an HTTP 200 or a green source CI job with the intended version being live.

After deployment, `node scripts/check-brand-production.mjs` compares served icon
bytes, checks actual browser metadata and brand geometry, and saves desktop/mobile
captures plus the social raster under ignored `test-results/brand-release/`.