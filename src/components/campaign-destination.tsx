import Link from "next/link";
import { cn } from "@/lib/utils";
import { campaignsTranslator, type Words } from "@/i18n/words";
import { WEBSITE_CTAS, type WebsiteCta } from "@/lib/campaign/connect-contracts";
import type { LeadDestination } from "@/lib/types/campaign";

/** #2595: the destinations the composer can choose (Call stays planner-only). */
export type ComposerDestination = Exclude<LeadDestination, "call">;

const choice = (active: boolean) => cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200");

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
  const options: [ComposerDestination, string][] = [["whatsapp", t("destination.whatsapp")], ["instant_form", t("destination.instantForm")]];
  if (offerWebsite || value === "website") options.push(["website", t("destination.website")]);
  return (
    <fieldset disabled={disabled} aria-describedby={describedBy} className="flex flex-wrap gap-2">
      <legend className="mb-2 text-xs font-medium text-slate-500">{t("destination.legend")}</legend>
      {options.map(([option, label]) => <label key={option} className={choice(value === option)}><input id={`destination-${option}`} type="radio" name="campaign-destination" value={option} checked={value === option} onChange={() => onChange(option)} className="accent-blue-600" />{label}</label>)}
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
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium leading-none text-slate-900">{t("destination.websiteLink")}</span>
        {href
          ? <a id="website-destination" href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-0 items-center break-all text-sm font-medium text-blue-700 underline">{href}</a>
          : <p id="website-destination" role="status" className="text-sm text-amber-800">{t("destination.noWebsite")} <Link href="/brand" className="inline-flex min-h-11 items-center font-medium text-blue-700 underline">{t("destination.openBrand")}</Link></p>}
      </div>
      <fieldset disabled={disabled} className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium leading-none text-slate-900">{t("destination.ctaLegend")}</legend>
        <div className="flex flex-wrap gap-2">
          {WEBSITE_CTAS.map((option) => <label key={option} className={choice(cta === option)}><input id={`website-cta-${option}`} type="radio" name="website-cta" value={option} checked={cta === option} onChange={() => onCta(option)} className="accent-blue-600" />{t(`destination.cta.${option}`)}</label>)}
        </div>
        <p className="text-xs text-slate-500">{t("destination.ctaNote")}</p>
      </fieldset>
    </div>
  );
}

/** The server Review's destination line: the link launch sends (an "Open destination" tap) and its button. */
export function WebsiteReviewFact({ url, cta = "learn_more", words }: { url?: string | null; cta?: WebsiteCta; words?: Words<"campaigns"> }) {
  const t = campaignsTranslator(words);
  const href = websiteHref(url);
  return <>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-blue-700 underline">{href}</a> : <span className="text-amber-800">{t("destination.noWebsite")}</span>}
    <span className="block text-slate-600">{t("destination.reviewButton", { cta: t(`destination.cta.${cta}`) })}</span>
  </>;
}
