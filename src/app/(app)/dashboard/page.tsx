import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { SpendStatusBanner } from "@/components/spend-status";
import { RecentActivity, WorkspaceHome } from "@/components/workspace-home";
import { getMetaConnection } from "@/lib/meta/credentials";
import { newestWaitingEnquiry, recentReplyMinutes } from "@/lib/leads/reply-time";
import {
  getCampaigns,
  getCreativePreviews,
  getAuditLog,
  getLatestResults,
  getPrimaryBusiness,
  getSpendEvaluation,
} from "@/lib/supabase/queries";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const business = await getPrimaryBusiness();
  const spendStatus = business ? getSpendEvaluation(business.id).then<ReactNode, ReactNode>(
    ({ evaluation }) => evaluation.status === "approaching" || evaluation.status === "over"
      ? <SpendStatusBanner evaluation={evaluation} /> : null,
    () => <Alert variant="error">Spend status could not be loaded. Check your saved limits in <Link href="/settings" className="font-medium underline">Settings</Link>.</Alert>,
  ) : null;
  const activity = business ? getAuditLog(business.id, 8).then<ReactNode, ReactNode>(
    (audit) => <RecentActivity audit={audit} />,
    () => <Alert variant="error">Recent activity could not be loaded.</Alert>,
  ) : null;
  const [creatives, campaigns, metaConnection] = business
    ? await Promise.all([
        getCreativePreviews(business.id),
        getCampaigns(business.id),
        getMetaConnection(business.id),
      ])
    : [[], [], null];
  // #764: the Home results row; an unreadable result leaves the row out, never the page.
  const launched = campaigns.filter((campaign) => campaign.meta_campaign_id).map((campaign) => campaign.id);
  const [results, replyMinutes, firstEnquiry] = await Promise.all([
    launched.length ? getLatestResults(launched).catch(() => ({})) : {},
    // #1049: an unreadable reply time leaves the line out, never the page.
    business ? recentReplyMinutes(business.id).catch(() => null) : null,
    // #1292: same rule; an unreadable enquiry leaves the line out.
    business ? newestWaitingEnquiry(business.id).catch(() => null) : null,
  ]);

  return (
    <WorkspaceHome
      business={business}
      creatives={creatives}
      campaigns={campaigns}
      results={results}
      replyMinutes={replyMinutes}
      firstEnquiry={firstEnquiry}
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
