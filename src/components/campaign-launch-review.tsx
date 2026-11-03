import { LockKeyhole, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { WeeklyCapNotice } from "@/lib/campaign/spend";
import { WeeklyCapLine } from "@/components/weekly-cap-line";
import { WebsiteGoal, WebsiteReviewFact, websiteHref, type ComposerDestination } from "@/components/campaign-destination";
import { campaignsTranslator, type Words } from "@/i18n/words";

export function CampaignLaunchReview({
  selectedCount,
  budget,
  leadFormName,
  destination = "whatsapp",
  whatsappNumber,
  website,
  audience,
  weeklyCap = null,
  words,
}: {
  selectedCount: number;
  budget: number;
  leadFormName?: string;
  destination?: ComposerDestination;
  /** The chosen WhatsApp button number, masked as the owner sees it. */
  whatsappNumber?: string;
  /** #2595: the Brand website a website ad opens, and its button. */
  website?: string | null;
  audience: string;
  /** #1342: the Settings cap against this campaign's weekly commitment. */
  weeklyCap?: WeeklyCapNotice | null;
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  const websiteLink = destination === "website" ? websiteHref(website) : null;
  const destinationReady = destination === "whatsapp" ? !!whatsappNumber : destination === "website" ? !!websiteLink : !!leadFormName;
  const isReady =
    selectedCount > 0 &&
    budget > 0 &&
    destinationReady &&
    audience.trim().length > 0 &&
    audience !== "Choose an area" &&
    !weeklyCap?.exceeds;

  return (
    <section aria-labelledby="launch-review-title" className="flex min-w-0 flex-col gap-4">
      {/* #847 T6: a plain summary, not a tinted box with an icon tile; the words carry the "paused" promise. */}
      <div>
        <p id="launch-review-title" className="flex items-center gap-2 font-semibold text-slate-950">
          <LockKeyhole className={cn("h-4 w-4 flex-none", isReady ? "text-emerald-700" : "text-slate-500")} aria-hidden="true" />
          {isReady ? t("launchReview.readyTitle") : t("launchReview.reviewTitle")}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {isReady ? t("launchReview.readyBody") : t("launchReview.pausedBody")}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {destination === "website" && <div>
          <dt className="text-xs text-slate-500">{t("destination.goal")}</dt>
          <dd className="mt-1 font-medium text-slate-900"><WebsiteGoal words={words} /></dd>
        </div>}
        <div>
          <dt className="text-xs text-slate-500">{destination === "website" ? t("destination.reviewWebsite") : t("launchReview.leadDestination")}</dt>
          <dd className={cn("mt-1 break-words font-medium", destinationReady ? "text-slate-900" : "text-amber-700")}>
            {destination === "website"
              ? <WebsiteReviewFact url={websiteLink} words={words} />
              : destination === "whatsapp"
                ? whatsappNumber ? t("launchReview.whatsappChat", { number: whatsappNumber }) : t("launchReview.whatsappPending")
                : leadFormName ?? t("launchReview.chooseLeadForm")}
          </dd>
          {/* #906/#680/#2598: no destination runs on Audience Network, where taps were mostly accidental. */}
          <dd className="mt-1 text-xs text-slate-500">{t("launchReview.shownOn")}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("launchReview.ad")}</dt>
          <dd className={cn("mt-1 font-medium", selectedCount ? "text-slate-900" : "text-amber-700")}>
            {selectedCount ? t("launchReview.selected", { n: selectedCount }) : t("launchReview.selectAd")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("launchReview.dailyBudget")}</dt>
          <dd className={cn("mt-1 font-medium", budget > 0 ? "text-slate-900" : "text-amber-700")}>
            {budget > 0 ? t("launchReview.perDay", { money: formatMoney(budget) }) : t("launchReview.enterBudget")}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" /> {t("launchReview.audience")}
          </dt>
          <dd className="mt-1 break-words font-medium text-slate-900">
            {audience}
          </dd>
          <dd className="mt-1 text-xs text-slate-500">
            {t("launchReview.audienceNote")}
          </dd>
        </div>
      </dl>
      <WeeklyCapLine notice={weeklyCap} announce={false} />
    </section>
  );
}
