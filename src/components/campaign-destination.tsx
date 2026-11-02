import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { campaignsTranslator, type Words } from "@/i18n/words";
import { WEBSITE_CTAS, type WebsiteCta } from "@/lib/campaign/connect-contracts";
import type { LeadDestination } from "@/lib/types/campaign";

/** #2595: the destinations the composer can choose (Call stays planner-only). */
export type ComposerDestination = Exclude<LeadDestination, "call">;

const selectedBox = (active: boolean) => active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white";
const focusRing = "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-1";
const openButton = "inline-flex min-h-11 flex-none items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50";

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

/** The website the ads open and the ad's button. The button is wording only: phase 1 optimises for landing-page views. */
export function WebsiteDestinationFields({ website, cta, onCta, disabled, words }: {
  website?: string | null;
  cta: WebsiteCta;
  onCta: (cta: WebsiteCta) => void;
  disabled?: boolean;
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  const href = websiteHref(website);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-900">{t("destination.websiteLink")}</span>
        {href
          ? <>
            <div id="website-destination" className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 py-1.5 pl-3 pr-1.5 text-sm"><WebsiteLinkText href={href} /><OpenWebsite href={href} words={words} /></div>
            <Link href="/brand" className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-blue-700 underline underline-offset-4">{t("destination.changeInBrand")}</Link>
          </>
          : <p id="website-destination" role="status" className="text-sm text-amber-800">{t("destination.noWebsite")} <Link href="/brand" className="inline-flex min-h-11 items-center font-medium text-blue-700 underline underline-offset-4">{t("destination.openBrand")}</Link></p>}
      </div>
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-slate-900">{t("destination.ctaLegend")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {WEBSITE_CTAS.map((option) => (
            <label key={option} className={cn("flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm", focusRing, cta === option ? "border-blue-300 bg-blue-50 font-medium text-blue-700" : "border-slate-200 bg-white text-slate-900")}>
              <input id={`website-cta-${option}`} type="radio" name="website-cta" value={option} checked={cta === option} onChange={() => onCta(option)} className="sr-only" />
              {t(`destination.cta.${option}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t("destination.ctaNote")}</p>
      </fieldset>
    </div>
  );
}

/** #2595: the goal a website ad is bought for, shown first in Review. */
export function WebsiteGoal({ words }: { words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  return <>{t("destination.goalWebsite")}<span className="block text-xs text-slate-500">{t("destination.goalWebsiteHint")}</span></>;
}

/** Review's destination for a website ad: the link launch sends, an Open tap, and the ad's button. */
export function WebsiteReviewFact({ url, cta = "learn_more", words }: { url?: string | null; cta?: WebsiteCta; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  const href = websiteHref(url);
  return <span className="flex min-w-0 items-start justify-between gap-3">
    <span className="min-w-0">
      {href ? <span className="block"><WebsiteLinkText href={href} /></span> : <span className="block font-medium text-amber-800">{t("destination.needsLink")}</span>}
      <span className="block text-slate-600">{t("destination.reviewButton", { cta: t(`destination.cta.${cta}`) })}</span>
    </span>
    {href && <OpenWebsite href={href} words={words} />}
  </span>;
}

/** The server Review's first rows for a website ad (#2595: goal, then where people go). */
export function WebsiteReviewFacts({ url, cta, words }: { url?: string | null; cta?: WebsiteCta; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  const row = "grid grid-cols-[5.75rem_1fr] gap-3 sm:grid-cols-[7.5rem_1fr] sm:gap-4";
  return <>
    <div className={row}><dt className="text-slate-500">{t("destination.goal")}</dt><dd className="min-w-0 text-slate-900"><WebsiteGoal words={words} /></dd></div>
    <div className={row}><dt className="text-slate-500">{t("destination.reviewWebsite")}</dt><dd className="min-w-0 text-slate-900"><WebsiteReviewFact url={url} cta={cta} words={words} /><span className="block text-slate-600">Shown on Facebook, Instagram and Messenger</span></dd></div>
  </>;
}
