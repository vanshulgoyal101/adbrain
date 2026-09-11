# Production Demo Rehearsal: 2026-09-11

This is a historical receipt for production commit `147f887`, not acceptance
evidence for the current deployment. PR #3 subsequently replaced the shared
server-token campaign path with owner-scoped Meta connections and saved drafts.
The Solaride connection observations and campaign controls below describe the
rehearsal build only. The harness must not be used to claim that a newer build
passed without a new run. Paid generation and approval writes require fresh
authorization; committing this receipt does not authorize either.

## Recommendation

Use the dedicated Cedar Ridge Chiropractic demo account for a creative-generation,
review, approval, and export demonstration. A real production image was generated
successfully during this rehearsal. Keep the prepared creative and exported ZIP
available so the presentation does not depend on another live model request.

Do not demonstrate live campaign creation, activation, or lead sync from this
account. Its production Settings still uses the server-managed Solaride ad account;
its campaign selector contains Solaride lead forms, and its campaign list includes
old traffic/test campaigns. These are not Cedar Ridge-specific Meta assets.

## Live Generation Evidence

- Production: https://adbrain.vanshul.com, deployed commit `147f887`.
- Account: dedicated demo account; workspace Cedar Ridge Chiropractic.
- Real browser password login succeeded. Credentials were read only inside the
  local process, never printed or added to this document.
- Two real creative-interview calls returned HTTP 200 and produced a usable brief.
- One real generation POST returned HTTP 200 with one persisted draft creative.
- Elapsed interview plus generation time: 142 seconds.
- The production assistant normally sends `count: 3`. For this authorized smoke
  test, the intercepted request was reduced to `count: 1`. No generation response
  was mocked, and there was no second generation or automatic retry.
- Text model: `openrouter / qwen/qwen3.8-max-0902`.
- Image model: `openrouter-image / openai/gpt-image-2`.
- Image receipt: 35,540 ms; source dimensions 1152 x 1536; image cost USD 0.0524.
  Text charges are additional; this is not the total bill or a future price quote.
- Headline: "$49 new-patient exam and consultation". The amount and included
  posture scan are present in the saved demo Brand Brain.
- [Open the tested creative](https://adbrain.vanshul.com/studio?creative=2eed374b-3a92-459a-877b-ded8b1c08c20)
  after signing in to the demo account.
- Image and copy were inspected in the production Review screen. The generated
  clinic scene is illustrative, not documentary evidence of a real business.
- Reload found the same saved creative. It was briefly approved with explicit
  permission, approval persisted, and it was restored to `draft`. A final
  owner-scoped database read confirmed the draft status after a browser reload
  timeout during the restoration check.

The previous timeout-recovery patch is **not deployed**: the live recovery GET
endpoint still returns 405, and the patch remains in the local working tree.
One successful one-ad run does not establish that the default three-ad assistant
batch is reliable or that the original timeout cause is eliminated.

## Verified Workflow

The browser rehearsal covered 1440, 1024, 768, and 390 CSS-pixel widths. The
32 page visits below all returned HTTP 200, retained the demo session, and had no
global error page or horizontal document overflow. No runtime page errors or
failed HTTP reads were recorded in the completed run.

| Step | Verified Result | Boundary |
| --- | --- | --- |
| Homepage, login, legal and metadata routes | Eight public routes returned 200 | Google and magic-link sign-in not exercised |
| Password sign-in | Real demo session reached the workspace | No dev bypass used |
| Home | Saved business, recent creative and activity rendered | Did not claim historical metrics were live performance |
| Brand Brain | Saved fields and all three brand images rendered | No brand, instruction or asset changes saved |
| Create | Goal editing and navigation/resumption worked | Two live interview calls in the separate paid smoke test |
| Review | All 37 displayed images loaded after waiting; search and Approved filter worked | 36 saved creatives after the smoke test, five approved |
| Preview | Image opened; keyboard focus, Escape and return focus worked | Screenshots inspected at all four widths |
| Approval | New test creative approved and restored to draft | No other creative was modified |
| Export | Real ZIP: five images plus `copy.txt`, 7,214,322 bytes, zero skipped images | No generation or Meta mutation involved |
| Single-ad setup | Review > New creative brief > Variants 1 > Portrait is usable | Submit not repeated during responsive checks |
| Assets | All 39 displayed images loaded | Read-only |
| Campaign setup | Creative selection, lead forms, mode retention and A/B total worked: INR 200 per set = INR 400 total | No create/plan/activate submitted; Solaride binding mismatch remains |
| Enquiries | Empty state and available search/filter controls rendered | Zero enquiries; no live sync or lead acquisition tested |
| Settings | Connected summary and guardrail controls rendered | Server-managed account, no weekly cap; nothing changed |
| Mobile menu | Open, Escape, return focus and navigation worked | No mobile Meta OAuth consent exercised |

An initial screenshot run was too early and showed image placeholders. Explicit
load/error waits confirmed the stored images are available; those early captures
are not image-failure evidence. One later browser reload timed out; the following
full read-only rehearsal completed successfully. Generation was never retried.

## Suggested Customer Sequence

1. Sign in to the dedicated demo account and open Brand Brain. Describe Cedar
   Ridge as a fictional demonstration business. Show the saved audience, offer,
   contact details and service areas without editing them.
2. Open Create and explain the short brief/interview. The default assistant asks
   for three images, so do not rely on it finishing during a short call.
3. For an optional new live image, use Review > New creative brief, set Variants
   to 1 and Portrait, and use only saved brand facts. This would be a new paid
   request outside today's completed one-request test. Allow several minutes.
4. Open the tested creative above, enlarge it, show the copy and CTA, and explain
   that the owner reviews factual claims and visuals before use.
5. Show approval and Export approved. The already downloaded ZIP provides a
   provider-independent fallback with five images and accompanying copy.
6. Describe campaign setup as a preview only. Avoid the live Create, Resume,
   Sync, and developer-tool buttons. Do not present Solaride's form as the
   clinic's destination or imply general Meta onboarding is verified.
7. Show Enquiries as the post-launch inbox layout, making clear that the demo
   has no enquiries and that lead acquisition was not tested today.

## Reproducible Evidence

Harness: `scripts/check-production-demo.mjs`. Default mode blocks business
mutations and paid calls; it permits only demo sign-in and the read-only export
when explicitly armed. Campaign auto-sync requests and analytics writes were
blocked, not mocked as successful. The production server may still perform normal
read-only Meta lead-form discovery while rendering Campaigns.

Commands run from this checkout, without printing environment values:

```sh
node --env-file-if-exists=.env.local scripts/check-production-demo.mjs --images-only
node --env-file-if-exists=.env.local scripts/check-production-demo.mjs --live-generation
node --env-file-if-exists=.env.local scripts/check-production-demo.mjs --approval-roundtrip --review-id=2eed374b-3a92-459a-877b-ded8b1c08c20
node --env-file-if-exists=.env.local scripts/check-production-demo.mjs
node --env-file-if-exists=.env.local scripts/check-production-demo.mjs --review-only
```

The live mode consumed the one-request authorization marker. Do not remove it
to repeat paid generation without new approval.

Private, ignored evidence under `.creative-evals/`:

- `demo-2026-09-11T18-24-28-707Z/`: real interview/generation receipt and result screenshots.
- `demo-2026-09-11T18-31-12-798Z/`: approval persistence evidence and reload-timeout warning.
- `demo-2026-09-11T18-33-42-542Z/`: complete 32-page rehearsal, export ZIP and screenshots.
- `demo-2026-09-11T18-41-02-387Z/`: single-variant controls, selected campaign review and corrected viewport preview screenshots.

## Scope

One paid image request and two interview requests were explicitly authorized.
Only the resulting draft creative was approved/restored for the separate authorized
round trip. No live Meta campaign creation, activation, pause, delete, sync,
consent, migration, configuration change, commit, push, or deployment occurred.
Provider reliability, customer account permissions and the unavailable production
timeout recovery remain separate from the successful smoke-test result.