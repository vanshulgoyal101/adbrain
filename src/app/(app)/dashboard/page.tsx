import { WorkspaceHome } from "@/components/workspace-home";
import { getMetaConnection } from "@/lib/meta/credentials";
import {
  getCampaigns,
  getCreatives,
  getAuditLog,
  getPrimaryBusiness,
  getSpendEvaluation,
} from "@/lib/supabase/queries";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const business = await getPrimaryBusiness();
  const [creatives, audit, campaigns, spend, metaConnection] = business
    ? await Promise.all([
        getCreatives(business.id),
        getAuditLog(business.id, 8),
        getCampaigns(business.id),
        getSpendEvaluation(business.id),
        getMetaConnection(business.id),
      ])
    : [[], [], [], null, null];

  return (
    <WorkspaceHome
      business={business}
      creatives={creatives}
      campaigns={campaigns}
      audit={audit}
      spend={spend?.evaluation ?? null}
      metaReady={metaConnection?.ready ?? false}
    />
  );
}
