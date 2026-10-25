/**
 * #419: an offline check of a planned campaign against Meta's guidance for a new advertiser,
 * run on the exact Graph payloads AdBrain would send. No Meta call, no spend.
 */
import { formatMoney, formatPerDay } from "@/lib/format";

/** Meta's learning phase ends after about 50 optimisation events within 7 days of the last significant edit. */
export const LEARNING_EVENTS_PER_WEEK = 50;

export type PlanCheckStatus = "pass" | "warn" | "fail" | "unknown";
export type PlanFinding = { rule: string; status: PlanCheckStatus; detail: string };

export type PlannedCampaign = {
  /** The `adsets` POST forms (one per ad set), as sent to Graph. */
  adSets: Record<string, string>[];
  /** The `adcreatives` POST forms, as sent to Graph. */
  creatives: Record<string, string>[];
  /** Typical cost per result (chat or lead) for this business, if we know one. */
  costPerResultRupees?: number | null;
};

const parse = (value: string | undefined): Record<string, unknown> => {
  try {
    return value ? JSON.parse(value) as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const PLACEMENT_KEYS = ["publisher_platforms", "facebook_positions", "instagram_positions", "audience_network_positions", "messenger_positions", "device_platforms"];

export function checkPlan(plan: PlannedCampaign): PlanFinding[] {
  const findings: PlanFinding[] = [];
  const targetings = plan.adSets.map((form) => parse(form.targeting));

  const advantage = targetings.every((t) => (t.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience === 1);
  findings.push({
    rule: "Advantage+ audience",
    status: advantage ? "pass" : "fail",
    detail: advantage ? "On: Meta can reach past the age range and interests, never outside the area." : "Off on at least one ad set: a new advertiser's narrow audience starves delivery (#334).",
  });

  const pinned = targetings.flatMap((t) => PLACEMENT_KEYS.filter((key) => key in t));
  findings.push({
    rule: "Advantage+ placements",
    status: pinned.length ? "warn" : "pass",
    detail: pinned.length ? `Placements are pinned (${[...new Set(pinned)].join(", ")}); Meta can't move budget to the cheapest placement.` : "Automatic: Meta places the ad wherever results are cheapest.",
  });

  findings.push({
    rule: "One ad set",
    status: plan.adSets.length === 1 ? "pass" : "warn",
    detail: plan.adSets.length === 1 ? "The whole budget learns in one ad set." : `${plan.adSets.length} ad sets split the budget, so each needs ${LEARNING_EVENTS_PER_WEEK} results a week on its own.`,
  });

  const dailyBudgets = plan.adSets.map((form) => Number(form.daily_budget) / 100).filter((n) => Number.isFinite(n) && n > 0);
  const perAdSet = dailyBudgets.length ? Math.min(...dailyBudgets) : 0;
  if (!plan.costPerResultRupees || plan.costPerResultRupees <= 0) {
    findings.push({
      rule: "Budget vs learning phase",
      status: "unknown",
      detail: `No cost per result yet. At ${formatPerDay(perAdSet)}, learning needs a cost per result under ${formatMoney((perAdSet * 7) / LEARNING_EVENTS_PER_WEEK)}.`,
    });
  } else {
    const weekly = (perAdSet * 7) / plan.costPerResultRupees;
    findings.push({
      rule: "Budget vs learning phase",
      status: weekly >= LEARNING_EVENTS_PER_WEEK ? "pass" : "warn",
      detail: `About ${Math.floor(weekly)} results a week at ${formatPerDay(perAdSet)} and ${formatMoney(plan.costPerResultRupees)} each (Meta's learning phase needs about ${LEARNING_EVENTS_PER_WEEK}). ${weekly >= LEARNING_EVENTS_PER_WEEK ? "" : `It needs about ${formatPerDay(Math.ceil((LEARNING_EVENTS_PER_WEEK * plan.costPerResultRupees) / 7))}, or it may stay "learning limited".`}`.trim(),
    });
  }

  const stories = plan.creatives.some((form) => {
    const feed = parse(form.asset_feed_spec) as { asset_customization_rules?: { customization_spec?: { facebook_positions?: string[]; instagram_positions?: string[] } }[] };
    return (feed.asset_customization_rules ?? []).some((rule) => [...rule.customization_spec?.facebook_positions ?? [], ...rule.customization_spec?.instagram_positions ?? []].some((p) => /story|reels/.test(p)));
  });
  const feedImage = plan.creatives.every((form) => {
    const story = parse(form.object_story_spec) as { link_data?: { image_hash?: string } };
    return Boolean(story.link_data?.image_hash) || Boolean(form.asset_feed_spec);
  });
  findings.push({
    rule: "4:5 feed image",
    status: feedImage && plan.creatives.length ? "pass" : "fail",
    detail: feedImage && plan.creatives.length ? "Every ad has a feed image." : "An ad has no image.",
  });
  findings.push({
    rule: "9:16 Stories/Reels image",
    status: stories ? "pass" : "warn",
    detail: stories ? "Stories and Reels get a full-screen image." : "No 9:16 image: Stories and Reels crop the 4:5 picture (#333).",
  });
  return findings;
}

const ruleSlug = (rule: string) => rule.toLowerCase().replace(/\+/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * #419 item 2(a): the launch's plan check as a product event. Rules that didn't pass, by name and
 * status (never details or payloads); a warning or failure makes it partial, an unknown doesn't.
 */
export function planCheckEvent(findings: PlanFinding[], destination: string) {
  return {
    outcome: findings.some((finding) => finding.status === "warn" || finding.status === "fail") ? "partial" as const : "success" as const,
    attributes: {
      ...(destination === "instant_form" || destination === "whatsapp" ? { destination: destination as "instant_form" | "whatsapp" } : {}),
      count: findings.length,
      failedCount: findings.filter((finding) => finding.status === "fail").length,
      validationRules: findings.filter((finding) => finding.status !== "pass").map((finding) => `${ruleSlug(finding.rule)}:${finding.status}`),
    },
  };
}

/** #419 item 2(b), CTO Oct 25: shown on Review when they apply; never block a launch. */
export const REVIEW_WARNINGS = {
  story: "No 9:16 ad: Reels and Stories placements will crop or skip it",
  budget: "Budget is below what Meta needs to learn (about 50 results a week); results may be slow",
} as const;

/**
 * The Review warnings for a planned campaign. A 9:16 is made only for WhatsApp ads with a saved
 * design (#333). The budget warning needs the business's own cost per result; without one it says
 * nothing rather than guess.
 */
export function reviewWarnings(input: {
  destination: "instant_form" | "whatsapp";
  storyReady: boolean;
  perAdSetDailyBudgetRupees: number;
  costPerResultRupees?: number | null;
}): string[] {
  const warnings: string[] = [];
  if (!(input.destination === "whatsapp" && input.storyReady)) warnings.push(REVIEW_WARNINGS.story);
  const cost = input.costPerResultRupees;
  if (cost && cost > 0 && (input.perAdSetDailyBudgetRupees * 7) / cost < LEARNING_EVENTS_PER_WEEK) warnings.push(REVIEW_WARNINGS.budget);
  return warnings;
}

