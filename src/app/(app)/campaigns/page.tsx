import { reconnectByLabel } from "@/lib/meta/token-expiry";
import { Alert } from "@/components/ui/alert";
import { clientCreative } from "@/lib/creative/client-receipt";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Campaigns } from "@/components/campaigns";
import { adResultsEnabled } from "@/lib/campaign/ad-results-store";
import { draftDtoSchema, type DraftDTO } from "@/lib/campaign/connect-contracts";
import { listEditableDrafts } from "@/lib/campaign/draft-repository";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import { ReadyAdsNextStep } from "@/components/ready-ads-next-step";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  getMetaConnection,
} from "@/lib/meta/credentials";
import {
  getActiveCampaignBudgets,
  getApprovedCreatives,
  getCampaignPage,
  getLatestResultsWithEnquiries,
  getPrimaryBusiness,
  getSpendLimits,
} from "@/lib/supabase/queries";

export const metadata = { title: "Campaigns" };

/** #847: the owner's saved drafts in the first render, read as /api/campaign-drafts does; on any error the client loads them as before. */
async function savedDrafts(businessId: string): Promise<DraftDTO[] | undefined> {
  try {
    const actor = await requireOwnedBusiness(businessId);
    return draftDtoSchema.array().parse(await listEditableDrafts(await createClient(), actor));
  } catch {
    return undefined;
  }
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your business and generate some creatives first.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const campaignData = getCampaignPage(business.id).then(async (page) => ({
    ...page,
    results: await getLatestResultsWithEnquiries(page.campaigns.map((campaign) => campaign.id)),
  }));
  // #1342: the Settings cap and the live budgets, for the cap line; on error the line is left out and Activate still refuses.
  const spendCap = Promise.resolve()
    .then(() => Promise.all([getSpendLimits(business.id), getActiveCampaignBudgets(business.id)]))
    .then(([limits, active]) => ({ capRupees: limits.weeklyCapRupees, active }))
    .catch(() => null);
  const [approved, page, connection, drafts, weeklyCap] = await Promise.all([
    getApprovedCreatives(business.id).then((rows) => rows.map(clientCreative)),
    campaignData,
    getMetaConnection(business.id),
    savedDrafts(business.id),
    spendCap,
  ]);
  const metaReady = connection.ready;
  const reconnectBy = connection.source === "oauth" && !connection.expired ? reconnectByLabel(connection.tokenExpiresAt) : null;
  const campaigns = page.campaigns;
  const requested = typeof params.creatives === "string" ? params.creatives.split(",") : [];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Launch your approved ads on Meta, pause them and see what they bring in."
      />
      {/* #757: warn a week before the Facebook connection stops working, while managing still works. */}
      {reconnectBy && (
        <Alert variant="warning" className="mt-6">
          Reconnect Facebook by {reconnectBy} to keep managing your ads. <Link href="/settings" className="font-medium underline underline-offset-4">Open Settings</Link>
        </Alert>
      )}
      <div className="mt-6">
        {/* Before Meta's App Review a new owner can't connect, so the setup form would be a dead end (#336). */}
        {!metaReady && !campaigns.length && approved.length ? (
          <ReadyAdsNextStep approved={approved} phone={business.phone ?? null} businessId={business.id} />
        ) : <Campaigns
          business={business}
          approved={approved}
          initialCampaigns={campaigns}
          initialNextCursor={page.nextCursor}
          initialDrafts={drafts}
          initialResults={page.results}
          renderId={crypto.randomUUID()}
          leadForms={[]}
          leadFormError={null}
          metaReady={metaReady}
          adResults={adResultsEnabled()}
          adAccountId={connection.adAccountId ?? ""}
          weeklyCap={weeklyCap}
          newCampaign={params.new === "1" ? { creativeIds: requested, review: params.review === "1" } : undefined}
        />}
      </div>
    </div>
  );
}
