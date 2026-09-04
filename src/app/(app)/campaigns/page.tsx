import Link from "next/link";
import { Building2 } from "lucide-react";
import { Campaigns } from "@/components/campaigns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type LeadForm } from "@/lib/meta/client";
import {
  getMetaConnection,
  metaClientForBusiness,
} from "@/lib/meta/credentials";
import {
  getApprovedCreatives,
  getCampaigns,
  getLatestResults,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const metadata = { title: "Campaigns — AdBrain" };

/** Meta can be slow or down; a failure here must not take the page with it. */
async function loadLeadForms(
  businessId: string,
): Promise<{ forms: LeadForm[]; error: string | null }> {
  try {
    const meta = await metaClientForBusiness(businessId);
    return { forms: (await meta?.listLeadForms()) ?? [], error: null };
  } catch (err) {
    return { forms: [], error: (err as Error).message };
  }
}

export default async function CampaignsPage() {
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

  // Nothing here depends on anything else, so pay for one round-trip, not three.
  const [approved, campaigns, connection] = await Promise.all([
    getApprovedCreatives(business.id),
    getCampaigns(business.id),
    getMetaConnection(business.id),
  ]);
  const metaReady = connection.ready;

  // Results need the campaign ids; lead forms need the connection. Independent.
  const [results, leadFormData] = await Promise.all([
    getLatestResults(campaigns.map((c) => c.id)),
    metaReady
      ? loadLeadForms(business.id)
      : Promise.resolve({ forms: [] as LeadForm[], error: null }),
  ]);
  const { forms: leadForms, error: leadFormError } = leadFormData;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
      <p className="mt-1 text-slate-600">
        Launch approved creatives into Meta as an Advantage+ lead campaign —
        created paused, so nothing spends until you activate it.
      </p>
      <div className="mt-6">
        <Campaigns
          business={business}
          approved={approved}
          initialCampaigns={campaigns}
          initialResults={results}
          leadForms={leadForms}
          leadFormError={leadFormError}
          metaReady={metaReady}
          adAccountId={connection.adAccountId ?? ""}
        />
      </div>
    </div>
  );
}
