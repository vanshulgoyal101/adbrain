import { setAsideIds } from "@/lib/creative/set-aside";
import { translator, type AppLocale } from "@/i18n/locale";
import type { Business, Campaign, Creative } from "@/lib/types";

export interface WorkItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "attention" | "work";
}

type QueueBusiness = Pick<
  Business,
  "name" | "description" | "brand_voice" | "target_audience" | "locations"
>;

type BrandField = "description" | "voice" | "audience" | "areas";

/**
 * #1630 (CPO, #1604): the ₹999 plan's status, as #1442's `readPlan` returns it, or null while PLAN_BILLING_ENABLED is
 * off or the business isn't on the plan. Home is where a pilot owner lives, so the free month's end shows there.
 */
export type QueuePlan =
  | { state: "exempt" }
  | { state: "trial_not_started" }
  | { state: "free" | "paid"; until: string; dueSoon: boolean }
  | { state: "unpaid"; since: string };

function planItem(plan: QueuePlan | null | undefined, locale: AppLocale): WorkItem | null {
  const t = translator(locale, "workQueue");
  if (plan?.state === "unpaid")
    return { id: "plan", title: t("planDueTitle"), detail: t("planDueDetail"), href: "/settings#plan-title", action: t("planPayAction"), tone: "attention" };
  if (plan?.state === "free" && plan.dueSoon) {
    const date = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date(plan.until));
    return { id: "plan", title: t("planFreeEndsTitle", { date }), detail: t("planFreeEndsDetail"), href: "/settings#plan-title", action: t("planPayAction"), tone: "work" };
  }
  return null;
}

function missingFields(business: QueueBusiness): BrandField[] {
  return ([
    !business.description?.trim() && "description",
    !business.brand_voice?.trim() && "voice",
    !business.target_audience?.trim() && "audience",
    !business.locations.some((location) => location.trim()) && "areas",
  ] as const).filter((field): field is BrandField => Boolean(field));
}

export function missingBrandContext(business: QueueBusiness, locale: AppLocale = "en"): string[] {
  const t = translator(locale, "workQueue");
  return missingFields(business).map((field) => t(`field.${field}`));
}

export function buildWorkQueue({
  business,
  creatives,
  campaigns,
  metaReady,
  now = Date.now(),
  locale = "en",
  unloggedChats = 0,
  plan = null,
}: {
  business: QueueBusiness | null;
  creatives: (Pick<Creative, "id" | "status"> & Partial<Pick<Creative, "created_at" | "variant_group">>)[];
  campaigns: Pick<Campaign, "status" | "creative_ids">[];
  metaReady: boolean;
  now?: number;
  /** #1438: the owner's app language. */
  locale?: AppLocale;
  /** #1624: WhatsApp chats with no real enquiry or customer logged yet (`unloggedChats`). */
  unloggedChats?: number;
  /** #1630: the ₹999 plan, when billing is on (see `QueuePlan`). */
  plan?: QueuePlan | null;
}): WorkItem[] {
  const t = translator(locale, "workQueue");
  if (!business)
    return [
      {
        id: "brand",
        title: t("brandTitle"),
        detail: t("brandDetail"),
        href: "/brand",
        action: t("brandAction"),
        tone: "work",
      },
    ];

  const queue: WorkItem[] = [];
  // #1148: set-aside ads (older than 7 days, or not picked from their Create batch) don't need review.
  const setAside = setAsideIds(creatives, now);
  const drafts = creatives.filter(
    (creative) => creative.status === "draft" && !setAside.has(creative.id),
  ).length;
  const approved = creatives.filter((creative) => creative.status === "approved").length;
  const running = campaigns.some((campaign) => campaign.status === "active");
  const usedIds = new Set(
    campaigns.flatMap((campaign) => campaign.creative_ids),
  );
  const unusedApproved = creatives.filter(
    (creative) => creative.status === "approved" && !usedIds.has(creative.id),
  ).length;
  const missing = missingBrandContext(business, locale);
  const paused = campaigns.filter(
    (campaign) => campaign.status === "paused",
  ).length;
  const draftCampaigns = campaigns.filter(
    (campaign) => campaign.status === "draft",
  ).length;

  if (drafts)
    queue.push({
      id: "review",
      title: t("reviewTitle", { n: drafts }),
      detail: t("reviewDetail"),
      href: "/studio?status=draft",
      action: t("reviewAction"),
      tone: "work",
    });
  if (unloggedChats > 0)
    queue.push({
      id: "chats",
      title: t("chatsTitle", { n: unloggedChats }),
      detail: t("chatsDetail"),
      href: "/leads",
      action: t("chatsAction"),
      tone: "work",
    });
  if (missing.length)
    queue.push({
      id: "context",
      title: t("contextTitle"),
      detail: t("contextDetail", { fields: missing.join(", ") }),
      href: "/brand",
      action: t("contextAction"),
      tone: "attention",
    });
  if (!creatives.length)
    queue.push({
      id: "create",
      title: t("createTitle"),
      detail: t("createDetail"),
      href: "/create",
      action: t("createAction"),
      tone: "work",
    });
  if (!metaReady && campaigns.length)
    queue.push({
      id: "connection",
      title: t("connectionTitle"),
      detail: t("connectionDetail"),
      href: "/settings",
      action: t("connectionAction"),
      tone: "attention",
    });
  // #1148: with approved ads and nothing running, launching comes before reviewing more ads.
  const launchFirst = metaReady && !running && !paused && !draftCampaigns && approved > 0;
  if (launchFirst)
    queue.unshift({
      id: "launch",
      title: t("launchTitle"),
      detail: t("launchDetail", { n: approved }),
      href: "/campaigns",
      action: t("launchAction"),
      tone: "work",
    });
  else if (!metaReady && !campaigns.length && unusedApproved)
    queue.push({
      id: "approved",
      title: t("readyTitle"),
      detail: t("readyDetail"),
      href: "/campaigns",
      action: t("readyAction"),
      tone: "work",
    });
  else if (unusedApproved)
    queue.push({
      id: "approved",
      title: t("approvedTitle", { n: unusedApproved }),
      detail: t("approvedDetail"),
      href: metaReady ? "/campaigns" : "/studio?status=approved",
      action: metaReady ? t("prepareAction") : t("exportAction"),
      tone: "work",
    });
  if (paused || draftCampaigns)
    queue.push({
      id: "campaigns",
      title: t("campaignsTitle"),
      detail: t("campaignsDetail", { paused, draft: draftCampaigns }),
      href: "/campaigns",
      action: t("campaignsAction"),
      tone: "work",
    });
  // #1630: the plan comes first; an unpaid plan stops new ads and campaigns.
  const due = planItem(plan, locale);
  if (due) queue.unshift(due);
  return queue;
}
