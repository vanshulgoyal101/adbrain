# Imported skills

Open-source agent skills, copied unchanged from the pinned commits below unless
a row says otherwise. AGENTS.md wins on any conflict. To update a skill, copy
its folder again from a newer commit and change the pin.

| Skill | Use it for | Source | License |
|---|---|---|---|
| frontend-design | Distinctive, polished UI | anthropics/skills | Apache-2.0 (in its folder) |
| vercel-react-best-practices | React and Next.js speed rules | vercel-labs/agent-skills (`react-best-practices`) | MIT (upstream README) |
| next-bundle-optimizer | Smaller first-load JavaScript | vercel/next.js | MIT |
| web-design-guidelines | UI review: accessibility, forms, focus, copy | vercel-labs/agent-skills + vercel-labs/web-interface-guidelines | MIT. Changed: reads the pinned `guidelines.md` (upstream `command.md`) instead of fetching the live URL |
| core-web-vitals | LCP, INP and CLS with evidence | addyosmani/web-quality-skills | MIT |
| systematic-debugging | Root cause before any fix | obra/superpowers | MIT |
| test-driven-development | Red test first | obra/superpowers | MIT |
| variant-analysis | Find other copies of a bug | trailofbits/skills | CC-BY-SA-4.0 |
| supabase-postgres-best-practices | Queries, indexes, RLS, migrations | supabase/agent-skills | MIT |
| supabase | Auth, Storage, RLS, Cron, Queues | supabase/agent-skills | MIT |
| playwright-cli | Browser checks and QA walks (`npx playwright cli`) | microsoft/playwright-cli | Apache-2.0 |
| verification-before-completion | Evidence before saying "done" or "live" | obra/superpowers | MIT |
| differential-review | Security review of risky diffs | trailofbits/skills | CC-BY-SA-4.0 |
| github-actions-hardening | CI workflow security | github/awesome-copilot | MIT |
| writing-plans | Split work into small tasks | obra/superpowers | MIT |
| subagent-driven-development | Build a plan with subagents and reviews | obra/superpowers | MIT |
| dispatching-parallel-agents | Run independent tasks in parallel | obra/superpowers | MIT |

License texts are in [LICENSES](LICENSES/). vercel-labs/agent-skills states MIT
in its README and ships no license file.

## Pins (Oct 24, 2026)

- anthropics/skills `dbd4588f9e1033efb41dad4bef2f7947c8993d44`
- vercel-labs/agent-skills `063bee94c3f4df8453406c830b0a7df0f2860278`
- vercel-labs/web-interface-guidelines `434b7f91364665f2f733b310ec54809bf8f37937`
- vercel/next.js (canary) `8b583887cee277dd7036bcfdfeafbd1d6e37fc59`
- addyosmani/web-quality-skills `afa8da942115f2961fdbfa80807ea0b232ff6c00`
- supabase/agent-skills `c9be0e931b7930f7d02126d04774d904c381e7d7`
- microsoft/playwright-cli `b1a5903c5b633b8c9f843ad7b629c2a78437040c`
- obra/superpowers `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`
- trailofbits/skills `196a9073ab10d35bacf111f945e02c00b2c6883a`
- github/awesome-copilot `d85f762d6e521abf5fe16703946e9b38adc42da7`
