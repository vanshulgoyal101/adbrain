# How We Got Here — The Road to AdBrain

A record of the reasoning behind the product, including the paths we rejected and
why. The point of this doc is that future-us can see *why* this was chosen, not
just *what* was chosen.

## Starting constraints (the filters everything had to pass)

- **Goal:** impact (AI-adjacent) — but sequenced *after* career capital
  (80,000 Hours logic: build leverage first, spend it on impact later).
- **Risk appetite:** low. Family depends on the income. → Keep the United job;
  it funds life and gives near-free SF flights. Don't quit, don't take a big
  loan, don't go all-in on something not owned.
- **Strengths:** roughly equal at building and BD (business development —
  selling, networking, fundraising; proven via NASA HERC ₹23L and Solaride).
- **Commitment:** one project, ~40 hrs/week, 90 days. No more idea-hopping.
- **Chosen optimization for project #1:** *maximum traction* (fastest path to
  real, paying users), because the single proven weakness was lack of traction
  (two YC rejections, no users). Impact is deferred to project #2.

## The funnel of ideas (and why each was dropped)

1. **Health-AI infrastructure/tooling for AI startups** — dropped. Build-vs-buy
   problem (technical buyers build it themselves), trust barrier for a solo
   India-based founder handling health data, and the warmest contact (Sukhi /
   zHealth) had *pivoted into health AI themselves* — so we'd be competing with
   our own best door.
2. **Vertical AI for non-technical buyers (health clinics / solar)** — kept as a
   principle (sell to buyers who *can't* build), but no specific wedge yet.
3. **Broadening the search** — mapped aviation (United insider edge), Indian SMB
   (warm founder network), robotics/space (ruled out: needs lab/capital, fails
   the "buildable solo in 90 days" filter). Surfaced that highest-*impact*
   domains ≠ highest-*access* domains, and chose access/traction for project #1.
4. **The "AI business builder" category (Polsia)** — Vanshul was drawn to it.
   We reverse-engineered Polsia: an autonomous agent that runs a whole company
   (research → code → deploy → tweets → cold outreach → ads → Stripe) for
   $20/mo. Its structural weakness: **it manufactures activity, not outcomes** —
   a mile wide, an inch deep. Great activation and virality, but no real
   customers delivered.
5. **A depth-focused wedge: cold outreach for solopreneurs** — the idea was to
   go deep where Polsia is shallow ("Polsia sends emails; we book meetings").
   Two problems: (a) it assumed Polsia does outreach badly, which we had *no
   evidence* for (an honest correction — that was wishful thinking), and (b) the
   solopreneur/indie audience is the classic trap: cheap, churny, DIY, and its
   demand was unproven.

## The pivot that stuck: local SMB Facebook ads

The breakthrough was grounded in **real, first-hand evidence** instead of
theory. Solaride already spends **~₹20K/month on Facebook ads**, and nearby
businesses spend similar amounts. That single fact fixed the thing every earlier
idea lacked:

- **Proven demand** — money is already being spent, every month, by us.
- **Warm access** — 10 real buyers reachable in person this week.
- **Obvious ROI + existing budget** — they already pay agencies 15–30% of spend;
  we redirect money that's already moving.

Trade-off accepted: this idea has *better demand & access* but *worse
defensibility* than the outreach idea (Meta competes; it can drift into a
service business). Given the low-risk, income-dependent profile, **proven demand
+ warm access beats clean-but-unproven.**

## The strategic principles that shaped the product

- **Value flees to the scarce complement** (from the "Will Money Become
  Obsolete?" essay): AI made *building* abundant, so value moved to
  *distribution*. Ads/getting-customers is the scarce side worth owning.
- **Depth over breadth** — the opposite of Polsia. Do one job (ads for solar
  SMBs) extremely well rather than ten jobs shallowly.
- **Make Meta infrastructure, not the enemy** — don't out-optimize Meta's
  targeting; launch creatives *into* Advantage+ and let its ML do delivery. We
  own **creative + simplicity + vertical + plain-language results**; Meta owns
  optimization.
- **The moat is creative quality + brand context + UX**, not "running ads"
  (which is commodity, and free via Advantage+).
- **Verticalize** — start with **solar**, where we have Solaride as customer
  zero, a proof case, and genuine domain knowledge.
- **Validate cheaply** — dogfood on Solaride first; if AI creatives can't beat
  our own current ₹20K/mo ads, stop. And we already own Solaride's Meta ad
  account, so we can build and test live via API immediately (no App Review for
  own accounts).

## Open risks we're consciously carrying

- **Meta Advantage+ commoditization** — the platform automates "run ads" for
  free. Our answer is creative + simplicity + vertical, not mechanics.
- **Creative quality is do-or-die** — if the AI images look like slop, the
  product dies. Most effort goes here.
- **Service-business drift** — spending customers' money is high-touch and
  churny; must stay productized, not become another desi service grind.
- **Impact gap** — this is the traction-first project, not the impact goal. That
  is intentional; impact is project #2, funded by the leverage this builds.

## One-line summary

We optimized project #1 for *traction*, followed the evidence to the one place
we have proven spend and warm access (local solar SMBs buying Facebook ads), and
scoped a product whose moat is **AI creative + simplicity for a vertical**, with
Meta Advantage+ as the engine and Solaride as customer zero.
