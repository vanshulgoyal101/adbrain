import { clientCreative } from "@/lib/creative/client-receipt";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Campaigns } from "@/components/campaigns";
import { ReadyAdsNextStep } from "@/components/ready-ads-next-step";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  getMetaConnection,
} from "@/lib/meta/credentials";
import {
  getApprovedCreatives,
  getCampaignPage,
  getLatestResultsWithEnquiries,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const metadata = { title: "Campaigns" };

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
              Set up your Brand Brain and generate some creatives first.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
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
  const [approved, page, connection] = await Promise.all([
    getApprovedCreatives(business.id).then((rows) => rows.map(clientCreative)),
    campaignData,
    getMetaConnection(business.id),
  ]);
  const metaReady = connection.ready;
  const campaigns = page.campaigns;
  const requested = typeof params.creatives === "string" ? params.creatives.split(",") : [];

  return (
    <div>
      <PageHeader
        eyebrow="Launch"
        title="Campaigns"
        description="Turn approved ads into Meta lead campaigns with the audience, budget, and destination reviewed before anything can spend."
      />
      <div className="mt-6">
        {/* Before Meta's App Review a new owner can't connect, so the setup form would be a dead end (#336). */}
        {!metaReady && !campaigns.length && approved.length ? (
          <ReadyAdsNextStep approved={approved} phone={business.phone ?? null} />
        ) : <Campaigns
          business={business}
          approved={approved}
          initialCampaigns={campaigns}
          initialNextCursor={page.nextCursor}
          initialResults={page.results}
          leadForms={[]}
          leadFormError={null}
          metaReady={metaReady}
          adAccountId={connection.adAccountId ?? ""}
          newCampaign={params.new === "1" ? { creativeIds: requested } : undefined}
        />}
      </div>
    </div>
  );
}
