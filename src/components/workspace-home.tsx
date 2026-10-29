import type { ReactNode } from "react";
import Link from "next/link";
import { PauseAllAds } from "@/components/pause-all-ads";
import { Building2, CheckCircle2, ChevronRight, ImageIcon } from "lucide-react";
import { SpendStatusBanner } from "@/components/spend-status";
import { buildWorkQueue } from "@/lib/work-queue";
import { setAsideIds } from "@/lib/creative/set-aside";
import { describeAuditEvent, isBackgroundAuditAction } from "@/lib/audit-labels";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { formatClock, formatDate, formatMoney, formatPerDay } from "@/lib/format";
import { firstEnquiryLine } from "@/lib/trust-lines";
import { homeResults } from "@/lib/campaign/home-results";
import { homeVerdicts } from "@/lib/campaign/card-verdict";
import { staleCampaignIds } from "@/lib/campaign/results-freshness";
import { StaleResultsRefresher } from "@/components/stale-results-refresher";
import type { SpendEvaluation } from "@/lib/campaign/spend";
import type { AuditLog, Business, Campaign, CampaignResult, CreativePreview } from "@/lib/types";
import { campaignAttention } from "@/lib/campaign/health";
import { formatReplyTime } from "@/lib/leads/first-reply";
import { campaignStatus, Status } from "@/components/ui/status";
import { goneInMeta, recentlyDeletedInMeta } from "@/lib/campaign/gone-in-meta";
import type { HomeAdReview } from "@/lib/campaign/home-ad-review";
import { timeAgoIn, translator, type AppLocale } from "@/i18n/locale";

export interface WorkspaceHomeProps {
  business: Business | null;
  creatives: CreativePreview[];
  campaigns: Campaign[];
  audit: AuditLog[];
  metaReady: boolean;
  spend: SpendEvaluation | null;
  spendStatus?: ReactNode;
  activity?: ReactNode;
  /** Each launched campaign's latest result (#764). */
  results?: Record<string, CampaignResult>;
  /** #1049: median minutes from enquiry to the owner's first reply over the last 30 days. */
  replyMinutes?: number | null;
  /** #1274: enquiries waiting for a first reply (the inbox's rule, #1260). */
  waiting?: number;
  /** #1292: the newest enquiry from the last 24 hours still waiting for a first reply. */
  firstEnquiry?: { name: string | null; at: string } | null;
  /** #1469: the newest live campaign is waiting on Meta's review, or Meta disapproved one of its ads. */
  adReview?: HomeAdReview | null;
  /** #1469: the streamed rejected-ads section, shown when `adReview` is "rejected". */
  rejectedAds?: ReactNode;
  /** #1650: the day-7 'would you pay ₹999 a month?' card, when it's due. */
  pilotQuestion?: ReactNode;
  now?: number;
  /** #1438: the owner's app language (Settings); English by default. */
  locale?: AppLocale;
}

const primaryClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
const linkClass = "inline-flex min-h-11 items-center font-medium text-blue-700 hover:underline";

/** #847 "calm by default": three figures, one next step, campaigns and the latest ads. */
export function WorkspaceHome({
  business,
  creatives,
  campaigns,
  audit,
  metaReady,
  spend,
  spendStatus,
  activity,
  results = {},
  replyMinutes = null,
  waiting = 0,
  firstEnquiry = null,
  adReview = null,
  rejectedAds,
  pilotQuestion,
  now,
  locale = "en",
}: WorkspaceHomeProps) {
  const t = translator(locale, "home");
  // #1600 (Designer #1633): a campaign deleted in Meta keeps its Home row for a week, with the CPO's line as its status.
  const liveCampaigns = campaigns.filter((campaign) => !goneInMeta(campaign) || recentlyDeletedInMeta(campaign, now));
  const summary = business ? homeResults(campaigns, results) : null;
  // #1292's line already names the newest person waiting, so the verdict doesn't say it twice.
  const verdicts = business ? homeVerdicts(campaigns, results, { now, waiting: firstEnquiry ? 0 : waiting }) : null;
  const leadCampaign = verdicts?.lead ? campaigns.find((campaign) => campaign.id === verdicts.lead?.campaignId) : null;
  const stale = business ? staleCampaignIds(campaigns, results, now) : [];
  const [next, ...later] = buildWorkQueue({ business, creatives, campaigns, metaReady, now, locale });
  const setAside = setAsideIds(creatives, now);
  const reviewLabel = (creative: CreativePreview) => creative.status === "approved" ? t("approved") : setAside.has(creative.id) ? t("setAside") : t("needsReview");
  const places = business?.locations.length ? business.locations.join(", ") : null;

  return (
    <div className="space-y-8" lang={locale === "en" ? undefined : locale}>
      <header className="min-w-0">
        <h1 className="break-words text-2xl font-semibold tracking-[-0.01em] text-slate-950">
          {business?.name ?? t("welcome")}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          {business
            ? [business.vertical || t("localBusiness"), places].filter(Boolean).join(" · ")
            : t("startWithBusiness")}
        </p>
      </header>

      {spendStatus ?? (spend && (spend.status === "approaching" || spend.status === "over") && (
        <SpendStatusBanner evaluation={spend} />
      ))}

      {firstEnquiry && (
        <section aria-label={t("newestEnquiry")} className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-900">
            {firstEnquiryLine(firstEnquiry.name, formatClock(firstEnquiry.at, now === undefined ? undefined : new Date(now)))}
          </p>
          <Link href="/leads" className={`${linkClass} shrink-0`}>{t("openEnquiries")}</Link>
        </section>
      )}

      {/* #1469: the results verdict already says "Meta is checking" once a result row exists; this covers the time before it. */}
      {adReview?.kind === "checking" && !verdicts?.lead?.verdict.state.startsWith("not_showing") && (
        <p role="status" aria-label={t("metaReview")} className="text-sm text-slate-900">{t("metaChecking")}</p>
      )}
      {adReview?.kind === "rejected" && rejectedAds}
      {pilotQuestion}

      {stale.length > 0 && <StaleResultsRefresher campaignIds={stale} />}
      {summary && (
        <section aria-labelledby="results-title">
          <h2 id="results-title" className="sr-only">{t("resultsSoFar")}</h2>
          {/* #1934 (CPO #1924): a new offer re-runs the 3 steps in returning mode. */}
          <Link href="/brand?again=1" className="float-right ml-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50">
            {t("newCampaign")}
          </Link>
          {verdicts?.lead && leadCampaign && (
            <p className="mb-4 max-w-2xl text-[17px] leading-snug text-slate-900">
              {verdicts.lead.verdict.sentence}{" "}
              <Link href="/campaigns" className="text-sm font-medium text-blue-700 hover:underline">
                {leadCampaign.name || t("untitledCampaign")}
              </Link>
            </p>
          )}
          <dl className="grid grid-cols-3 gap-4 sm:flex sm:gap-16">
            {[
              { label: t("enquiries"), value: String(summary.enquiries) },
              { label: t("spent"), value: formatMoney(summary.spend) },
              { label: t("perEnquiry"), value: summary.perEnquiry === null ? null : formatMoney(summary.perEnquiry) },
            ].map((metric) => (
              <div key={metric.label} className="flex min-w-0 flex-col-reverse">
                <dt className="mt-1 text-xs text-slate-600">{metric.label}</dt>
                <dd className="break-words text-4xl font-medium tracking-[-0.02em] text-slate-950">
                  {metric.value ?? <span className="text-slate-400" aria-label={t("notYet")}>—</span>}
                </dd>
              </div>
            ))}
          </dl>
          {replyMinutes !== null && <p className="mt-3 text-sm text-slate-700">
            {/* #1443: the number is the owner's first WhatsApp/Call tap, not a reply AdBrain can see. */}
            {t.rich("contactTime", { time: formatReplyTime(replyMinutes), strong: (chunks) => <strong className="font-medium">{chunks}</strong> })}{" "}
            <Link href="/leads" className={linkClass}>{t("seeEnquiries")}</Link>
          </p>}
          <p className="mt-3 text-xs text-slate-500">
            {t("updated", { ago: timeAgoIn(locale, new Date(summary.oldestFetchedAt), now === undefined ? undefined : new Date(now)) })} ·{" "}
            <Link href="/campaigns" className={linkClass}>{t("seeCampaigns")}</Link>
          </p>
        </section>
      )}

      <div className={business ? "grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_360px]" : undefined}>
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="work-title">
            <h2 id="work-title" className="sr-only">{t("nextStep")}</h2>
            {next ? (
              <>
                <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-slate-950">{next.title}</h3>
                    <p className="mt-1 max-w-xl text-sm text-slate-600">{next.detail}</p>
                  </div>
                  <Link href={next.href} className={primaryClass}>
                    {next.href === "/brand" && !business && <Building2 size={17} aria-hidden="true" />}
                    {business ? next.action : next.title}
                  </Link>
                </div>
                {later.length > 0 && (
                  <ul className="divide-y divide-slate-200 px-4 sm:px-6">
                    {later.slice(0, 1).map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 py-3 text-sm">
                        <span className={item.tone === "attention" ? "text-slate-900" : "text-slate-600"}>{item.title}</span>
                        <Link href={item.href} className={`${linkClass} inline-flex min-h-11 items-center`}>{item.action}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="flex items-start gap-3 py-4">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-blue-700" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{t("upToDate")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("nothingWaiting")} <Link href="/leads" className={linkClass}>{t("seeEnquiries")}</Link>
                  </p>
                </div>
              </div>
            )}
          </section>

          {business && (
            <section aria-labelledby="campaigns-title" className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <h2 id="campaigns-title" className="text-lg font-semibold text-slate-950">{t("campaigns")}</h2>
                {campaigns.length > 0 && (
                  <Link href="/campaigns" className={linkClass}>
                    {t("seeAll", { count: campaigns.length })}
                  </Link>
                )}
              </div>
              {/* #1150: campaigns deleted or archived in Meta stay on Campaigns, folded. */}
              {liveCampaigns.length ? (
                <ul className="mt-2 divide-y divide-slate-200 border-b border-slate-200">
                  {liveCampaigns.slice(0, 3).map((campaign) => {
                    const status = campaignStatus(campaign);
                    const attention = campaignAttention(campaign);
                    const judged = verdicts?.labels.get(campaign.id);
                    const deleted = goneInMeta(campaign) === "Deleted in Meta";
                    return (
                      <li key={campaign.id} className="py-3 sm:flex sm:items-center sm:justify-between sm:gap-6">
                        <div className="min-w-0">
                          <Link href="/campaigns" className="-my-3 block truncate py-3 text-sm font-medium text-slate-950 hover:text-blue-700">
                            {campaign.name || t("untitledCampaign")}
                          </Link>
                          {attention && <p className="mt-1 text-xs font-medium text-danger">Needs attention: {attention}</p>}
                        </div>
                        {deleted ? <p className="mt-1 text-sm text-slate-700 sm:mt-0 sm:max-w-xs">{t("deletedInMeta")}</p> : <p className="mt-1 flex shrink-0 gap-x-4 text-xs text-slate-600 sm:mt-0">
                          <Status tone={status.tone}>{status.label}</Status>
                          {judged && <span>{judged}</span>}
                          {campaign.daily_budget != null && <span className="sm:w-24 sm:text-right">{formatPerDay(campaign.daily_budget)}</span>}
                        </p>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  {campaigns.length ? t("noLiveCampaigns") : t("noCampaigns")}
                </p>
              )}
              {/* #1968: a quiet secondary stop while anything runs; each campaign resumes from its own card. */}
              <PauseAllAds locale={locale} campaigns={campaigns.filter((campaign) => campaign.status === "active" && !goneInMeta(campaign))
                .map(({ id, name, meta_ad_account_id, meta_campaign_id }) => ({ id, name, meta_ad_account_id, meta_campaign_id }))} />
            </section>
          )}
        </div>

        {creatives.length > 0 && (
          <section aria-labelledby="creatives-title" className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h2 id="creatives-title" className="text-lg font-semibold text-slate-950">{t("latestAds")}</h2>
              <Link href="/studio" className={linkClass}>{t("reviewAll")}</Link>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
              {creatives.slice(0, 4).map((creative) => (
                <li key={creative.id} className="min-w-0">
                  <Link href={`/studio?creative=${encodeURIComponent(creative.id)}`} aria-label={`${creative.headline || "Untitled ad"}: ${reviewLabel(creative).toLowerCase()}`} className="group block">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {creative.image_url ? (
                        <img
                          src={creativeThumbnailUrl(creative.image_url)}
                          alt={creative.headline || "Ad"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="text-slate-400" aria-label="No image" />
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600 group-hover:text-blue-700">
                      {reviewLabel(creative)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {activity ?? <RecentActivity audit={audit} locale={locale} />}
    </div>
  );
}

export function RecentActivity({ audit: all, locale = "en" }: { audit: AuditLog[]; locale?: AppLocale }) {
  const audit = all.filter((event) => !isBackgroundAuditAction(event.action));
  if (!audit.length) return null;
  return (
    <details className="group border-t border-slate-200 pt-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-950 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} aria-hidden="true" className="transition-transform group-open:rotate-90" />
        <span id="activity-title">{translator(locale, "home")("recentActivity")}</span>
      </summary>
      <ul aria-labelledby="activity-title" className="divide-y divide-slate-200">
        {audit.map((event) => (
          <li key={event.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
            <span className="text-slate-600">
              {describeAuditEvent(event.action, event.reason)}
              {event.authority !== "server" && <span className="ml-2 text-xs text-slate-500">Unverified legacy event</span>}
            </span>
            <time dateTime={event.created_at} className="text-xs text-slate-500">{formatDate(event.created_at)}</time>
          </li>
        ))}
      </ul>
    </details>
  );
}
