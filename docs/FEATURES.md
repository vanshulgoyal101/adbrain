# AdBrain — Features (living document)

> The single source of truth for **what exists** and **what's proposed** in AdBrain.
> Update this whenever a feature ships or a new idea is worth tracking.
>
> **Legend:** ✅ Built · 🚧 In progress · 📋 Proposed · 🔒 Blocked (needs access/prereq)
>
> _Last updated: 2026-08-12_

---

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
| 📋 | Multi-language brand (Hindi/Punjabi) | localise copy per region |

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
| ✅ | Results refresh + plain-language summary | insights → friendly sentence |
| ✅ | Learning loop | past results (angle/area/CPL) feed the planner |
| 📋 | AI picks ad type | lead form vs Click-to-WhatsApp vs Call (destination_type) |
| 📋 | Multiple ad sets/ads per campaign | audience-level A/B ("Advanced" mode) |
| 🔒 | True A/B split tests | Meta Experiments API |
| 📋 | Scheduled activation | launch at a chosen date/time |
| 📋 | Auto-optimisation | pause losers, scale winners on CPL |
| ✅ | Auto-sync on page load | silent sync when Campaigns opens; scheduled cron 📋 when hosted |

## 5. Leads
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Lead inbox | pulled from Meta instant forms, deduped |
| ✅ | WhatsApp-style digest | copy-ready summary of recent leads |
| 📋 | New-lead notifications | email / WhatsApp on arrival |
| 📋 | CRM / follow-up automation | statuses, reminders |

## 6. Results & optimisation
| Status | Feature | Notes |
| --- | --- | --- |
| ✅ | Campaign insights | impressions/clicks/leads/spend/CPL |
| ✅ | Plain-language summaries | LLM, jargon-free |
| ✅ | Performance context for planner | ranked past-campaign history |
| ✅ | Markdown performance report export | download per business (`/api/campaigns/report`) |
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
| ✅ | Vitest suite (106 tests) | pure logic, API contracts |
| ✅ | Lint + typecheck + build gating | every push |
| 🚧 | Hosting on adbrain.vanshul.com | needs host (Vercel) + DNS + prod env |
| 📋 | Billing / subscription | when multi-customer |
| 🔒 | Google Ads integration | needs MCC/Basic Access — Phase 2 |
