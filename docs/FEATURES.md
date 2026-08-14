# AdBrain — Features (living document)

> The single source of truth for **what exists** and **what's proposed** in AdBrain.
> Update this whenever a feature ships or a new idea is worth tracking.
>
> **Legend:** ✅ Built · 🚧 In progress · 📋 Proposed · 🔒 Blocked (needs access/prereq)
>
> _Last updated: 2026-08-13_

---

## North Star & principles

**North Star:** a non-technical local-business owner gets **more leads at a lower
cost** with **near-zero effort** — fill the brand once, type a goal, approve,
done. Every feature must move that number. The engine is **industry-agnostic**
(each business sets its own `vertical`); Solaride (solar) is just one customer.

**What we deliberately DON'T build (so the product stays simple):**
- Manual targeting micro-optimisation — **delegate to Meta Advantage+**, don't fight it.
- A full CRM / analytics suite — keep lead tracking **lightweight**; integrate, don't rebuild.
- New ad channels (Google, etc.) before Meta is nailed.
- Dashboards a busy owner won't read — results are **one plain-language line** (and WhatsApp), not charts.

## Roadmap focus

| Horizon | Bets |
| --- | --- |
| **Now** | Guided onboarding · Spend guardrails & alerts · Weekly WhatsApp results digest · Instant new-lead alerts |
| **Next** | AI-vs-baseline benchmark · Auto-optimisation · Lead → revenue (ROI) · Festival campaign suggestions |
| **Later** | Self-serve multi-customer · Agency / white-label · Video creatives · Google Ads |

## Recently shipped (2026-08-13)
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Ad Assistant (guided chat) | `/create` tab: type a request → one-tap Q&A (options · "Surprise me" · "Let AI decide") → finished ad. `lib/creative/interview.ts` + `api/creatives/assistant` + `components/ad-assistant.tsx` |
| ✅ | Industry-agnostic engine | universal `AD_ANGLES` + prompts driven by `brand.vertical`; Brand Brain has an Industry field |
| ✅ | General marketing/SEO | rebranded to "AI ad creative for any local business" |
| ✅ | Pause / resume campaigns | from the dashboard — `PATCH /api/campaigns/[id]` → Meta + local mirror + audit |
| ✅ | Privacy & Terms pages | `/privacy`, `/terms` with metadata + WebPage/Breadcrumb JSON-LD |
| ✅ | Per-user rate limiting | on generate/regenerate/plan/autofill (429 + Retry-After) |
| ✅ | SSRF redirect hardening | autofill re-validates every redirect hop (`fetchPublicUrlText`) |
| ✅ | Dev-bypass prod guard | disabled unless `NODE_ENV !== production` |

## 1. Auth & access
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Email magic-link sign-in | Supabase Auth |
| ✅ | Google OAuth sign-in | via `/auth/callback` |
| ✅ | Route guard | `src/proxy.ts` + `updateSession`; protects app routes |
| ✅ | Offline developer login | `NEXT_PUBLIC_DEV_AUTH_BYPASS`; real session when backend up, cookie fallback offline |
| 📋 | Team / multi-user per business | roles (owner/editor/viewer) |
| 🔒 | Multi-tenant OAuth (Facebook Login for Business) | needs Meta App Review — Phase 2 |

## 2. Brand Brain
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Business profile CRUD | voice, USPs, colours, offers, locations, audience |
| ✅ | Asset uploads | logo / product photos / past ads → Storage |
| ✅ | Autofill from website | scrape + LLM extract; SSRF-guarded (`lib/security/ssrf.ts`) |
| ✅ | Per-customer instruction files | Markdown, injected into every prompt |
| 📋 | Brand voice fine-tuning | learn tone from approved creatives |
| ✅ | Multi-language creatives (Hindi/Punjabi/Hinglish) | pick a language per generation in the Studio |

## 3. Creative Studio
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Generate 3–6 ad variants | copy + image per solar angle |
| ✅ | Solar angle library | savings, subsidy, trust, urgency, etc. |
| ✅ | Regenerate a single variant | with inline error surfacing |
| ✅ | Approve / unapprove / delete | draft ↔ approved workflow |
| ✅ | Image persistence to Storage | `lib/creative/persist.ts` (creatives bucket) |
| ✅ | Ad-pack export (ZIP) | images + copy.txt |
| ✅ | Assets library | browse/reuse/download all AI-generated images (`/assets`) |
| 📋 | Video creatives | when models are good/cheap enough |
| 📋 | Creative winner detection | promote the best-performing variant |
| 📋 | Festival / seasonal campaign suggestions | timely Diwali / Sankranti offers (India) |
| 📋 | Language badge + regenerate-in-language | finish localisation (needs `creatives.language`) |

## 4. Campaigns & targeting
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Manual campaign builder | pick creatives + budget + targeting |
| ✅ | Guided AI planner (Copilot-style Q&A) | structured questions with clickable options |
| ✅ | Location typeahead (include & exclude) | Meta `adgeolocation`; cities/regions/countries |
| ✅ | Radius + age controls | Meta min radius 17 km enforced |
| ✅ | "Let AdBrain decide" per field | AI fills from brand + goal |
| ✅ | Residents-only default | `location_types: home` — no traveller calls |
| ✅ | Budget helper | daily ₹ → "~X leads/week" + presets |
| ✅ | Meta launch (Advantage+ leads, PAUSED) | zero spend until activated |
| ✅ | Sync existing campaigns from Meta | manual button + auto-sync on page load |
| ✅ | Delete a campaign | removes it from Meta + AdBrain (with confirm) |
| ✅ | Results refresh + plain-language summary | insights → friendly sentence |
| ✅ | Learning loop | past results (angle/area/CPL) feed the planner |
| ✅ | AI picks ad type | instant form / Click-to-WhatsApp / Call, with fallback |
| ✅ | Audience A/B (multiple ad sets) | opt-in age split into 2 ad sets ("Advanced") |
| 🔒 | True A/B split tests | Meta Experiments API |
| 📋 | Scheduled activation | launch at a chosen date/time |
| 📋 | Auto-optimisation | pause losers, scale winners on CPL |
| 📋 | Spend guardrails & alerts | weekly cap + "spent ₹X" — no runaway spend, builds trust |
| 📋 | AI-vs-baseline benchmark | new AI ads vs the owner's previous ads (CPL lift) — the proof |
| ✅ | Auto-sync on page load | silent sync when Campaigns opens; scheduled cron 📋 when hosted |

## 5. Leads
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Lead inbox | pulled from Meta instant forms, deduped |
| ✅ | WhatsApp-style digest | copy-ready summary of recent leads |
| 📋 | New-lead notifications | email / WhatsApp on arrival |
| 📋 | Speed-to-lead alert | ping the owner within seconds — solar conversion is a speed game |
| 📋 | Lead → deal → revenue (ROI) | mark won + value; show return, not just cost per lead |
| 📋 | CRM / follow-up automation | statuses, reminders (lightweight, not a full CRM) |

## 6. Results & optimisation
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Campaign insights | impressions/clicks/leads/spend/CPL |
| ✅ | Plain-language summaries | LLM, jargon-free |
| ✅ | Performance context for planner | ranked past-campaign history |
| ✅ | Markdown performance report export | download per business (`/api/campaigns/report`) |
| 📋 | Weekly WhatsApp results digest | "14 leads at ₹19 each this week" — retention + the plain-language moat |
| 📋 | Trends dashboard | CPL/leads over time |

## 7. Observability & security
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Append-only audit log | tamper-resistant; who/what/when/why |
| ✅ | Dashboard activity + stats | recent events, creative counts |
| ✅ | RLS on every table | `owns_business` |
| ✅ | SSRF guard | blocks private/loopback/link-local hosts |
| ✅ | Generic error responses | no internal detail leakage (`lib/api.ts`) |
| ✅ | Input bounds on API routes | id caps, query length caps |

## 8. AI infrastructure
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Provider-agnostic LLM rotation | Gemini / Groq / OpenRouter / Cerebras |
| ✅ | Multi-key rotation + cooldown | parks 429'd keys |
| ✅ | JSON mode + robust parsing | fences/prose salvage |
| ✅ | Token usage capture + accounting | per-provider spend, `usageSnapshot()` |
| ✅ | Response cache + single-flight | opt-in `{cache}`, zero-cost identical calls |
| ✅ | Configurable Gemini thinking headroom | `GEMINI_THINKING_HEADROOM` (0 for paid non-thinking) |
| ✅ | Provider-abstracted image gen | Pollinations default (free, no key) |
| 📋 | Paid image providers | fal.ai / OpenAI images for quality |

## 9. Marketing & SEO
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Rich landing page | hero, how-it-works, features, FAQ, footer |
| ✅ | Full metadata + OG/Twitter | `metadataBase`, canonical, robots |
| ✅ | JSON-LD | Organization, WebSite, SoftwareApplication, FAQPage |
| ✅ | sitemap.xml / robots.txt / manifest | + dynamic OG image |

## 10. Platform & DX
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Next 16 App Router + TS + Tailwind v4 | |
| ✅ | zod-validated env | `lib/env.ts` |
| ✅ | Vitest suite (128 tests) | pure logic, API contracts, + jsdom component tests |
| ✅ | Lint + typecheck + build gating | every push |
| 🚧 | Hosting on adbrain.vanshul.com | needs host (Vercel) + DNS + prod env |
| 📋 | Billing / subscription | when multi-customer |
| 🔒 | Google Ads integration | needs MCC/Basic Access — Phase 2 |

## 11. Growth & business model
| Status | Feature | Notes |
| --- | --- | --- |
| 📋 | Guided onboarding wizard | first brand → first creatives → first paused campaign in one flow (activation) |
| 🔒 | Self-serve customer onboarding | needs multi-tenant OAuth (Phase 2) |
| 📋 | Referrals | solar SMBs invite other SMBs |
| 📋 | Agency / white-label | resellers manage many brands under one login |
| 📋 | Pricing tiers + billing | monetisation once multi-customer |

## 12. Solar vertical depth
| Status | Feature | Notes |
| --- | --- | --- |
| 📋 | Savings calculator in the funnel | qualify + raise lead intent (Solaride already has one) |
| 📋 | Subsidy eligibility helper | PM Surya Ghar guidance — India solar-specific |
| 📋 | Bill-based lead qualification | ask the monthly bill in the form → prioritise hot leads |
