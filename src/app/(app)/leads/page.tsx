import { Building2 } from "lucide-react";
import Link from "next/link";
import { LeadInbox } from "@/components/lead-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getMetaConnection } from "@/lib/meta/credentials";
import { getCampaigns, getLatestResultsWithEnquiries, getPrimaryBusiness } from "@/lib/supabase/queries";
import { WhatsAppChats } from "@/components/whatsapp-chats";
import { whatsappChatRows, type WhatsAppChatRow } from "@/lib/campaign/real-enquiries";
import { getLeadPage } from "@/lib/leads/queries";

export const metadata = { title: "Enquiries" };

export default async function LeadsPage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Enquiries</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your business and launch a campaign first. Enquiries
              land here.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [page, metaConnection, chatRows] = await Promise.all([
    getLeadPage(business.id),
    getMetaConnection(business.id),
    // #764: WhatsApp chats beside form leads; an unreadable read hides the section, never the inbox.
    getCampaigns(business.id).then(async (campaigns) => {
      const launched = campaigns.filter((campaign) => campaign.meta_campaign_id);
      return launched.length ? whatsappChatRows(launched, await getLatestResultsWithEnquiries(launched.map((campaign) => campaign.id))) : [];
    }).catch((): WhatsAppChatRow[] => []),
  ]);

  return (
    <div>
      <PageHeader
        title="Enquiries"
        titleInTopBarOnPhone
        description="People who responded to your ads."
      />
      <div className="mt-6 max-sm:mt-4">
        <LeadInbox
          key={`${business.owner_id}:${business.id}`}
          businessName={business.name}
          initialLeads={page.leads}
          initialTotal={page.total}
          initialNextCursor={page.nextCursor}
          metaReady={metaConnection.ready}
          syncScope={`${business.owner_id}:${business.id}:${metaConnection.adAccountId ?? ""}:${metaConnection.pageId ?? ""}`}
        />
        <WhatsAppChats rows={chatRows} />
      </div>
    </div>
  );
}
