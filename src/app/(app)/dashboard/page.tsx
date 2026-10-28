import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { SpendStatusBanner } from "@/components/spend-status";
import { RecentActivity, WorkspaceHome } from "@/components/workspace-home";
import { requestLocale } from "@/i18n/request-locale";
import { SetupResumeCard } from "@/components/setup-resume-card";
import { setupResumeStep } from "@/lib/setup/resume";
import { getMetaConnection } from "@/lib/meta/credentials";
import { HomeRejectedAds } from "@/components/home-rejected-ads";
import { adResultsEnabled } from "@/lib/campaign/ad-results-store";
import { homeAdReview, newestLiveCampaign } from "@/lib/campaign/home-ad-review";
import { inboxSummary, newestWaitingEnquiry, recentReplyMinutes } from "@/lib/leads/reply-time";
import {
  getCampaigns,
  getCreativePreviews,
  getAdStatuses,
  getAuditLog,
  getLatestResultsWithEnquiries,
  getPrimaryBusiness,
  getSpendEvaluation,
} from "@/lib/supabase/queries";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [business, locale] = await Promise.all([getPrimaryBusiness(), requestLocale()]);
  const spendStatus = business ? getSpendEvaluation(business.id).then<ReactNode, ReactNode>(
    ({ evaluation }) => evaluation.status === "approaching" || evaluation.status === "over"
      ? <SpendStatusBanner evaluation={evaluation} /> : null,
    () => <Alert variant="error">Spend status could not be loaded. Check your saved limits in <Link href="/settings" className="font-medium underline">Settings</Link>.</Alert>,
  ) : null;
  const activity = business ? getAuditLog(business.id, 8).then<ReactNode, ReactNode>(
    (audit) => <RecentActivity audit={audit} locale={locale} />,
    () => <Alert variant="error">Recent activity could not be loaded.</Alert>,
  ) : null;
  const [creatives, campaigns, metaConnection] = business
    ? await Promise.all([
        getCreativePreviews(business.id),
        getCampaigns(business.id),
        getMetaConnection(business.id),
      ])
    : [[], [], null];
  // #1272 (#1251 WS1): until a first campaign has gone live, Home is the one resume card.
  const resume = setupResumeStep({ business, creatives, campaigns });
  if (resume) return <SetupResumeCard step={resume} />;
  // #764: the Home results row; an unreadable result leaves the row out, never the page.
  const launched = campaigns.filter((campaign) => campaign.meta_campaign_id).map((campaign) => campaign.id);
  const newest = newestLiveCampaign(campaigns);
  const [results, replyMinutes, waiting, firstEnquiry, newestAdStatuses] = await Promise.all([
    // #1624: with the logged real enquiries and customers, so Home can ask which chats were real.
    launched.length ? getLatestResultsWithEnquiries(launched).catch(() => ({})) : {},
    // #1049: an unreadable reply time leaves the line out, never the page.
    business ? recentReplyMinutes(business.id).catch(() => null) : null,
    // #1274: people waiting for a reply (the inbox's Waiting count, #1260) lead Home's sentence; unreadable means none shown.
    business ? inboxSummary(business.id).then((summary) => summary.waiting ?? 0, () => 0) : 0,
    // #1292: same rule; an unreadable enquiry leaves the line out.
    business ? newestWaitingEnquiry(business.id).catch(() => null) : null,
    // #1469: the stored per-ad statuses (no Meta call); unreadable means no review line.
    newest && adResultsEnabled() ? getAdStatuses(newest.id).catch(() => null) : [],
  ]);
  const adReview = newest && newestAdStatuses ? homeAdReview([newest], { [newest.id]: newestAdStatuses }, results) : null;

  return (
    <WorkspaceHome
      business={business}
      creatives={creatives}
      campaigns={campaigns}
      results={results}
      replyMinutes={replyMinutes}
      waiting={waiting}
      firstEnquiry={firstEnquiry}
      adReview={adReview}
      rejectedAds={adReview?.kind === "rejected" && newest && (
        <Suspense fallback={null}>
          <HomeRejectedAds campaign={newest} spend={(results as Record<string, { spend?: number }>)[newest.id]?.spend ?? 0} />
        </Suspense>
      )}
      locale={locale}
      audit={[]}
      spend={null}
      spendStatus={spendStatus && (
        <Suspense fallback={<p role="status" className="text-sm text-slate-600">Checking spend status...</p>}>
          <SpendNotice result={spendStatus} />
        </Suspense>
      )}
      activity={activity && (
        <Suspense fallback={<p role="status" className="text-sm text-slate-600">Loading recent activity...</p>}>
          <Activity result={activity} />
        </Suspense>
      )}
      metaReady={metaConnection?.ready ?? false}
    />
  );
}

async function SpendNotice({ result }: { result: Promise<ReactNode> }) {
  return await result;
}

async function Activity({ result }: { result: Promise<ReactNode> }) {
  return await result;
}
