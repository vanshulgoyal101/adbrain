# AdBrain — Roadmap

The prioritized backlog: what to build next, ranked by **value to shipping a
product a stranger can pay for and trust**. Status markers and the full feature
inventory live in [FEATURES.md](./FEATURES.md); architecture in
[ARCHITECTURE.md](./ARCHITECTURE.md). This file answers "what next, and why".

> **Legend:** effort is a rough T-shirt size (S ≈ hours, M ≈ a day or two,
> L ≈ several days / needs external process).

_Last reviewed: 2026-08-17. Recently shipped: industry-agnostic `vertical` fix,
cross-instance rate limiting, Facebook-Login ad-account connect, Google sign-in,
**spend guardrails**._

---

## 🔴 High value — unblock selling & prove the thesis

| Task | Why it matters | Depends on | Effort |
| --- | --- | --- | --- |
| **Billing / subscriptions** | There is no way to take money today — every "plan" in the code is a *campaign* plan. Razorpay/Stripe + a `subscriptions` table + plan-gating + a usage meter (LLM/image cost). Without it, "product" isn't true. | pricing decision (Razorpay vs Stripe, tiers) | L |
| **Deploy to production** | Hosting is still pending on `adbrain.vanshul.com`. Nothing below reaches a customer until this is live (see DEPLOY.md). | Vercel project + prod env | M |
| **Meta App Review** | Until approved, only test users can connect their own ad accounts via Facebook Login. This is the gate between "works for Solaride" and "sellable to others". Weeks of lead time — **start now, in parallel**. | live app + privacy/data-deletion URLs | L |
| **AI-vs-baseline benchmark** | The proof the whole pitch rests on — "our AI ads beat your old ads" (CPL lift vs the owner's previous campaigns). Currently a claim we can't show. | historical insights import | M |
| **Instant new-lead alerts** | Local lead-gen is a speed game; leads that sit in the inbox are wasted spend. Push email/WhatsApp within seconds of arrival. | lead webhook or cron; a send channel | M |
| **Guided onboarding wizard** | A single guided flow (brand → first creatives → first paused campaign) is where SMB activation lives or dies. There's a checklist today, not a wizard. | — | M |

## 🟠 Moderate value — production hardening & retention

| Task | Why it matters | Depends on | Effort |
| --- | --- | --- | --- |
| **Scheduled sync (cron)** | Insights/leads only refresh when a page is opened. Digests, alerts and auto-pause all want a background job (Vercel Cron + a `CRON_SECRET`-guarded endpoint using the service-role key). | service-role key set | M |
| **Error/crash monitoring** | Great *audit* log, but no exception tracking (Sentry). In prod you'd be blind to real failures customers hit. | — | S |
| **Weekly WhatsApp results digest** | "14 leads at ₹19 each this week" — the retention hook and the plain-language moat. | scheduled sync + send channel | M |
| **Lead → deal → revenue (ROI)** | Show return, not just cost per lead — what justifies the subscription at renewal. Mark lead won + value. | — | M |
| **Paid image provider** | Creative quality is do-or-die; default Pollinations is free/variable. The `imageGen` layer is already swappable (fal.ai / OpenAI). | budget + key | S |
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

1. **Deploy** + **start Meta App Review** (parallel; App Review is the long pole).
2. **Error monitoring** (S) + **scheduled sync** (M) — the hardening that everything else leans on.
3. **Instant new-lead alerts** (M) — highest-trust, speed-to-lead win.
4. **Billing foundation** (L) — once pricing is decided.
5. **AI-vs-baseline benchmark** (M) — the proof for sales.
6. **Guided onboarding wizard** (M) — self-serve activation.
