import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { campaignsTranslator, type Words } from "@/i18n/words";
import type { LeadDestination, WebsiteGoal } from "@/lib/types/campaign";
import { websiteButton, type WebsiteButton } from "@/lib/campaign/website-button";
import { trackingBlocker, websiteGoalOpen, type ReviewTracking, type TrackingBlocker } from "@/lib/campaign/website-tracking";

/** #2595: the destinations the composer can choose (Call stays planner-only). */
export type ComposerDestination = Exclude<LeadDestination, "call">;

export type WebsiteGoalCopy = {
  legend: string;
  visits: string;
  leads: string;
  sales: string;
  needsTracking: string;
  unavailable: string;
  noSource: string;
  chooseTracking: string;
  unreadable: string;
  quiet: string;
  missing: string;
  finish: string;
};

export type WebsiteGoalChoice = {
  value: WebsiteGoal;
  tracking: ReviewTracking | undefined;
  onChange: (value: WebsiteGoal) => void;
  copy: WebsiteGoalCopy;
  disabled?: boolean;
};

export type WebsiteReviewDetails = {
  goal: WebsiteGoal;
  /** The reviewed attribution setting, formatted for this locale; null when it has not been confirmed. */
  attribution: string | null;
  copy: {
    goals: Record<WebsiteGoal, { label: string; hint: string }>;
    attributionLabel: string;
    attributionHelp: string;
    attributionUnavailable: string;
  };
};

const selectedBox = (active: boolean) => active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white";
const openButton = "inline-flex min-h-11 flex-none items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50";

function trackingGuidance(problems: (TrackingBlocker | null)[], copy: WebsiteGoalCopy): string | null {
  const keys = problems.map((problem) => problem?.key);
  if (keys.includes("trackingNone")) return copy.noSource;
  if (keys.includes("trackingChoose")) return copy.chooseTracking;
  if (keys.includes("trackingUnreadable")) return copy.unreadable;
  if (keys.includes("trackingQuiet")) return copy.quiet;
  if (keys.includes("trackingEventMissing")) return copy.missing;
  return null;
}

function WebsiteGoalChoices({ value, tracking, onChange, copy, disabled }: WebsiteGoalChoice) {
  const id = useId();
  const leads = trackingBlocker("leads", tracking);
  const sales = trackingBlocker("sales", tracking);
  const guidance = trackingGuidance([leads, sales], copy);
  const options = [
    { value: "visits", label: copy.visits, problem: null },
    { value: "leads", label: copy.leads, problem: leads },
    { value: "sales", label: copy.sales, problem: sales },
  ] as const;

  return (
    <fieldset disabled={disabled} className="mt-4 min-w-0">
      <legend className="mb-2 text-sm font-medium text-slate-900">{copy.legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const reason = option.problem ? copy.needsTracking : !websiteGoalOpen(option.value) ? copy.unavailable : null;
          const reasonId = `${id}-${option.value}-reason`;
          return (
            <label key={option.value} className={cn(
              "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600",
              selectedBox(value === option.value),
              reason ? "cursor-default text-slate-600" : "cursor-pointer text-slate-900",
            )}>
              <input type="radio" name={`website-goal-${id}`} value={option.value} checked={value === option.value}
                aria-label={option.label} aria-disabled={reason ? true : undefined} aria-describedby={reason ? reasonId : undefined}
                onChange={() => { if (!reason) onChange(option.value); }} className="h-4 w-4 flex-none accent-blue-600" />
              <span className="font-medium">{option.label}</span>
              {reason && <span id={reasonId} className="text-xs text-slate-600">{reason}</span>}
            </label>
          );
        })}
      </div>
      {guidance && <p role="status" className="mt-2 text-sm text-slate-600">{guidance}</p>}
      {guidance && <Link href="/brand?all=1#brand-tracking" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline underline-offset-4">{copy.finish}</Link>}
    </fieldset>
  );
}

/** The Brand website as a link the ad may open: http(s) only, a bare domain gets https. */
export function websiteHref(raw?: string | null): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** Review's link: preflight's `websiteUrl` once it has checked (null = no usable link); the Brand website only before that. */
export function reviewWebsiteUrl(checked: string | null | undefined, brandWebsite?: string | null): string | null | undefined {
  return checked === undefined ? brandWebsite : checked;
}

/** The link as an owner reads it: host, then the path, without the protocol. */
function websiteParts(href: string): { host: string; rest: string } {
  const url = new URL(href);
  return { host: url.host, rest: `${url.pathname === "/" ? "" : url.pathname}${url.search}` };
}

function WebsiteLinkText({ href }: { href: string }) {
  const { host, rest } = websiteParts(href);
  return <span className="min-w-0 break-all"><span className="font-medium text-slate-900">{host}</span>{rest && <span className="text-slate-500">{rest}</span>}</span>;
}

function OpenWebsite({ href, words }: { href: string; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  return <a href={href} target="_blank" rel="noopener noreferrer" className={openButton}>{t("destination.open")}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>;
}

/** Where the ad sends people. Inputs keep `destination-<value>` ids: Review fixes jump to them. */
export function DestinationChoice({ value, onChange, disabled, describedBy, offerWebsite, words }: {
  value: ComposerDestination;
  onChange: (value: ComposerDestination) => void;
  disabled?: boolean;
  describedBy?: string;
  /** TODO(#2595): internal-only until the Meta adapter, preflight and results slices are live; a restored website draft still shows it. */
  offerWebsite?: boolean;
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  // `name` stays the radio's accessible name ("WhatsApp chat (recommended)"); the hint is its description.
  const options: { value: ComposerDestination; title: string; name: string; hint: string; recommended?: boolean }[] = [
    { value: "whatsapp", title: t("destination.whatsapp"), name: t("destination.whatsappName"), hint: t("destination.whatsappHint"), recommended: true },
    { value: "instant_form", title: t("destination.instantForm"), name: t("destination.instantForm"), hint: t("destination.instantFormHint") },
  ];
  if (offerWebsite || value === "website") options.push({ value: "website", title: t("destination.website"), name: t("destination.website"), hint: t("destination.websiteHint") });
  return (
    <fieldset disabled={disabled} aria-describedby={describedBy} className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-slate-900">{t("destination.legend")}</legend>
      {options.map((option) => (
        <label key={option.value} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3", selectedBox(value === option.value))}>
          <input id={`destination-${option.value}`} type="radio" name="campaign-destination" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}
            aria-label={option.name} aria-describedby={`destination-${option.value}-hint`} className="mt-0.5 h-4 w-4 flex-none accent-blue-600" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
              {option.title}
              {option.recommended && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">{t("destination.recommended")}</span>}
            </span>
            <span id={`destination-${option.value}-hint`} className="text-xs text-slate-500">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The website the ads open. Each ad keeps its own button (QA, #2660): a button choice returns once preflight and launch carry it. */
export function WebsiteDestinationFields({ website, words, goalChoice }: {
  website?: string | null;
  words?: Words<"campaigns">;
  goalChoice?: WebsiteGoalChoice;
}) {
  const t = campaignsTranslator(words);
  const href = websiteHref(website);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-900">{t("destination.websiteLink")}</span>
      {href
        ? <>
          <div id="website-destination" className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 py-1.5 pl-3 pr-1.5 text-sm"><WebsiteLinkText href={href} /><OpenWebsite href={href} words={words} /></div>
          <Link href="/brand" className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-blue-700 underline underline-offset-4">{t("destination.changeInBrand")}</Link>
        </>
        : <p id="website-destination" role="status" className="text-sm text-amber-800">{t("destination.noWebsite")} <Link href="/brand" className="inline-flex min-h-11 items-center font-medium text-blue-700 underline underline-offset-4">{t("destination.openBrand")}</Link></p>}
      {goalChoice && <WebsiteGoalChoices {...goalChoice} />}
    </div>
  );
}

/** #2595: the goal a website ad is bought for, shown first in Review. */
export function WebsiteGoal({ words, review }: { words?: Words<"campaigns">; review?: WebsiteReviewDetails }) {
  const t = campaignsTranslator(words);
  if (review) {
    const goal = review.copy.goals[review.goal];
    return <>{goal.label}<span className="block text-xs text-slate-500">{goal.hint}</span></>;
  }
  return <>{t("destination.goalWebsite")}<span className="block text-xs text-slate-500">{t("destination.goalWebsiteHint")}</span></>;
}

export function WebsiteAttribution({ review }: { review: WebsiteReviewDetails }) {
  return <>{review.attribution?.trim() || review.copy.attributionUnavailable}<span className="block text-xs text-slate-500">{review.copy.attributionHelp}</span></>;
}

/** A selected ad as Review names it: its headline and its own button words. */
export type ReviewAd = { headline?: string | null; cta?: string | null };

const BUTTON_KEYS = { shop_now: "destination.buttonShopNow", sign_up: "destination.buttonSignUp", learn_more: "destination.buttonLearnMore" } as const satisfies Record<WebsiteButton, string>;

/** #2703: the button each website ad gets on Facebook (the rule launch sends), said once when every ad's matches. */
function WebsiteButtons({ ads, words }: { ads: readonly ReviewAd[]; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  const buttons = ads.map((ad) => websiteButton(ad.cta));
  if (!buttons.length) return null;
  if (buttons.every((button) => button === buttons[0])) {
    return <span className="block text-slate-600">{t("destination.button")}: <span className="font-medium text-slate-900">{t(BUTTON_KEYS[buttons[0]])}</span></span>;
  }
  return <span className="block text-slate-600">{t("destination.button")}:{ads.map((ad, index) => (
    <span key={index} className="flex min-w-0 gap-1.5">
      <span className="min-w-0 truncate">{ad.headline?.trim() || t("destination.adNumber", { n: index + 1 })}</span>
      <span className="flex-none font-medium text-slate-900">{t(BUTTON_KEYS[buttons[index]])}</span>
    </span>
  ))}</span>;
}

/** Review's destination for a website ad: the link launch sends, an Open tap and each ad's button. */
export function WebsiteReviewFact({ url, ads = [], words }: { url?: string | null; ads?: readonly ReviewAd[]; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  const href = websiteHref(url);
  return <>
    <span className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <span className="min-w-0">
        {href ? <span className="block"><WebsiteLinkText href={href} /></span> : <span className="block font-medium text-amber-800">{t("destination.needsLink")}</span>}
      </span>
      {href && <OpenWebsite href={href} words={words} />}
    </span>
    <WebsiteButtons ads={ads} words={words} />
  </>;
}

/** The server Review's first rows for a website ad (#2595: goal, then where people go). */
export function WebsiteReviewFacts({ url, ads, words, websiteReview }: {
  url?: string | null;
  ads?: readonly ReviewAd[];
  words?: Words<"campaigns">;
  websiteReview?: WebsiteReviewDetails;
}) {
  const t = campaignsTranslator(words);
  const row = "grid grid-cols-[5.75rem_1fr] gap-3 sm:grid-cols-[7.5rem_1fr] sm:gap-4";
  return <>
    <div className={row}><dt className="text-slate-500">{t("destination.goal")}</dt><dd className="min-w-0 text-slate-900"><WebsiteGoal words={words} review={websiteReview} /></dd></div>
    <div className={row}><dt className="text-slate-500">{t("destination.reviewWebsite")}</dt><dd className="min-w-0 text-slate-900"><WebsiteReviewFact url={url} ads={ads} words={words} /><span className="block text-slate-600">Shown on Facebook, Instagram and Messenger</span></dd></div>
    {websiteReview && <div className={row}><dt className="text-slate-500">{websiteReview.copy.attributionLabel}</dt><dd className="min-w-0 break-words text-slate-900"><WebsiteAttribution review={websiteReview} /></dd></div>}
  </>;
}
