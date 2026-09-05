# AdBrain — Roadmap

The prioritized backlog: what to build next, ranked by **value to shipping a
product a stranger can pay for and trust**. Status markers and the full feature
inventory live in [FEATURES.md](./FEATURES.md); architecture in
[ARCHITECTURE.md](./ARCHITECTURE.md). The product-design transformation,
acceptance criteria, and delivery sequence live in
[PRODUCT-DESIGN-ROADMAP.md](./PRODUCT-DESIGN-ROADMAP.md). This file answers
"what next, and why".

> **Legend:** effort is a rough T-shirt size (S ≈ hours, M ≈ a day or two,
> L ≈ several days / needs external process).

_Last reviewed: 2026-09-05. **Live in production at adbrain.vanshul.com.** Recently
shipped: industry-agnostic `vertical` fix, cross-instance rate limiting,
Facebook-Login ad-account connect, Google sign-in, **spend guardrails**._

> **Current product-design priority:** Sprint 1, shell and visual foundation.
> Establish the shared design system, lifecycle navigation, page-header rhythm,
> and Home foundation before adding more AI features.

---

## 🔴 High value — unblock selling & prove the thesis

| Task | Why it matters | Depends on | Effort |
| --- | --- | --- | --- |
| **Billing / subscriptions** | There is no way to take money today — every "plan" in the code is a *campaign* plan. Razorpay/Stripe + a `subscriptions` table + plan-gating + a usage meter (LLM/image cost). Without it, "product" isn't true. | pricing decision (Razorpay vs Stripe, tiers) | L |
| **Demo cost controls** | Before taking money, expose durable per-business AI usage, enforce a generation budget, and measure real copy/image cost across representative demos. See [DEMO-RUNBOOK.md](./DEMO-RUNBOOK.md). | paid/provider-backed usage measurement | M |
| **Meta App Review** | Until approved, only test users can connect their own ad accounts via Facebook Login. This is the gate between "works for Solaride" and "sellable to others". Weeks of lead time — **start now, in parallel**. | live app + privacy/data-deletion URLs | L |
| **AI-vs-baseline benchmark** | The proof the whole pitch rests on — "our AI ads beat your old ads" (CPL lift vs the owner's previous campaigns). Currently a claim we can't show. | historical insights import | M |
| **Instant new-lead alerts** | Local lead-gen is a speed game; leads that sit in the inbox are wasted spend. Push email/WhatsApp within seconds of arrival. | lead webhook or cron; a send channel | M |
| **Guided onboarding wizard** | A single guided flow (brand → first creatives → first paused campaign) is where SMB activation lives or dies. There's a checklist today, not a wizard. | — | M |
| **Product shell and visual foundation** | The current UI exposes implementation areas as equal navigation items and uses generic repeated cards. A coherent shell is required before page-level redesign can be evaluated. | design direction | M |
| **Home command center** | Replace record-count reporting with next-best-action, workflow status, and clear activation progress. | shell foundation | M |

## 🟠 Moderate value — production hardening & retention

| Task | Why it matters | Depends on | Effort |
| --- | --- | --- | --- |
| **Scheduled sync (cron)** | Insights/leads only refresh when a page is opened. Digests, alerts and auto-pause all want a background job (Vercel Cron + a `CRON_SECRET`-guarded endpoint using the service-role key). | service-role key set | M |
| **Error/crash monitoring** | Great *audit* log, but no exception tracking (Sentry). In prod you'd be blind to real failures customers hit. | — | S |
| **Branded auth domain (no `*.supabase.co`)** | Sign-in currently bounces the browser through the raw project host (`<ref>.supabase.co`) — for Google *and* for magic-link `verify` links. It looks untrustworthy next to a phishing warning, and on some networks (e.g. Safari + iCloud Private Relay) the browser shows a scary "connection is not private" interstitial instead of a login screen. Two routes: **(a)** Supabase **Pro custom domain** (`auth.adbrain.vanshul.com`) — near-zero code, also removes free-tier auto-pausing, ~$10/mo; **(b)** free but more code — run Google OAuth ourselves (`/api/auth/google/{start,callback}` reusing the HMAC-signed-state pattern from `lib/meta/oauth.ts`) and finish with `signInWithIdToken`, plus proxy `/auth/v1/verify` for magic links. Prefer (a) once on a paid plan. | (a) Pro plan; (b) Google Console redirect URI | (a) S · (b) M |
| **Weekly WhatsApp results digest** | "14 leads at ₹19 each this week" — the retention hook and the plain-language moat. | scheduled sync + send channel | M |
| **Lead → deal → revenue (ROI)** | Show return, not just cost per lead — what justifies the subscription at renewal. Mark lead won + value. | — | M |
| **Paid image provider** | Creative quality is do-or-die; default Pollinations is free/variable. The `imageGen` layer is already swappable (fal.ai / OpenAI). Evaluate one paid provider before recurring billing; private demos may continue using Pollinations with a fallback pack. | budget + key | S |
| **Long ops → job/queue** | Creative generation (LLM + image + compositing) runs inline; on serverless this risks function timeouts under load. | queue choice | M |
| **Trends dashboard** | CPL/leads over time — turns raw snapshots into a story owners revisit. | historical results | M |

## 🟢 Lower value — growth & depth (after the above)

| Task | Why it matters | Depends on | Effort |
| --- | --- | --- | --- |
| **Team / multi-user per business** | Roles (owner/editor/viewer); needed for agencies. | — | M |
| **Agency / white-label** | Resellers manage many brands under one login — a likely revenue channel. | multi-user | L |
| **Referrals** | SMBs invite other SMBs — cheap growth loop. | billing | S |
| **Auto-optimisation** | Pause losers, scale winners on CPL — automates the results loop. | scheduled sync | M |
| **Scheduled activation** | Launch a paused campaign at a chosen date/time. | cron | S |
| **Creative winner detection** | Promote the best-performing variant automatically. | per-creative metrics | M |
| **Video creatives** | When models are good/cheap enough. | paid provider | L |
| **Solar vertical depth** | Savings calculator, PM Surya Ghar subsidy helper, bill-based lead qualification — deepens the flagship vertical. | — | M |

---

## Suggested near-term sequence

1. **Product shell and visual foundation** — make the product coherent before layering on more surface area.
2. **Home command center + guided onboarding** — make activation and the next action obvious.
3. **Brand Brain redesign** — turn the strongest differentiator into a visible product asset.
4. **Creative Studio review workspace** — make creation, approval, and export feel like one workflow.
5. **Start Meta App Review** (the long pole — weeks of lead time; the app is already live for it).
6. **Error monitoring** (S) + **scheduled sync** (M) — the hardening that everything else leans on.
7. **Instant new-lead alerts** (M) — highest-trust, speed-to-lead win.
8. **Run controlled customer demos** using [DEMO-RUNBOOK.md](./DEMO-RUNBOOK.md); measure quality, latency, retries, and real provider cost before quoting pricing.
9. **Paid image provider + durable usage limits** (S/M) — quality and predictable commercial cost.
10. **Billing foundation** (L), then the AI-vs-baseline benchmark (M) — monetization and proof.
