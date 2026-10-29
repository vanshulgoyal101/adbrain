import { metaWaitFor } from "@/lib/meta/throttle-owner";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { LeadInbox } from "@/components/lead-inbox";
import { replyLanguage } from "@/lib/leads/first-reply";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getMetaConnection } from "@/lib/meta/credentials";
import { getCampaigns, getLatestResultsWithEnquiries, getPrimaryBusiness } from "@/lib/supabase/queries";
import { EnquiriesSections } from "@/components/enquiries-sections";
import { enquiriesTitle, whatsappChatRows, type WhatsAppChatRow } from "@/lib/campaign/real-enquiries";
import { getLeadPage } from "@/lib/leads/queries";
import { inboxSummary } from "@/lib/leads/reply-time";
import { readAlertSettings } from "@/lib/alerts/settings-read";

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

  const [page, metaConnection, chatRows, summary, alerts] = await Promise.all([
    getLeadPage(business.id),
    getMetaConnection(business.id),
    // #764: WhatsApp chats beside form leads; an unreadable read hides the section, never the inbox.
    getCampaigns(business.id).then(async (campaigns) => {
      const launched = campaigns.filter((campaign) => campaign.meta_campaign_id);
      return launched.length ? whatsappChatRows(launched, await getLatestResultsWithEnquiries(launched.map((campaign) => campaign.id))) : [];
    }).catch((): WhatsAppChatRow[] => []),
    // #1260: the inbox sentence; an unreadable count drops the sentence, never the list.
    inboxSummary(business.id).catch(() => null),
    readAlertSettings(business.id).catch(() => null),
  ]);

  // #1260: the inbox opens on Waiting when someone waits, so its first page (and Load more) is the New list.
  const waitingPage = summary?.waiting ? await getLeadPage(business.id, { status: "new" }).catch(() => null) : null;
  const firstPage = waitingPage ?? page;
  // #1597: nothing has come in at all (no form enquiry, no WhatsApp chat or logged enquiry).
  const chatsEmpty = chatRows.every((row) => row.chats === 0 && row.realEnquiries === 0);
  const whatsapp = chatRows[0];

  return (
    <div>
      <PageHeader
        title="Enquiries"
        titleInTopBarOnPhone
        description="People who responded to your ads."
      />
      <div className="mt-6 max-sm:mt-4">
        <EnquiriesSections chatRows={chatRows} formTotal={page.total} empty={chatsEmpty && page.total === 0}>
          <LeadInbox
            key={`${business.owner_id}:${business.id}`}
            businessName={business.name}
            offer={business.offers?.[0] ?? null}
            language={replyLanguage(business.languages)}
            initialLeads={firstPage.leads}
            initialTotal={firstPage.total}
            initialNextCursor={firstPage.nextCursor}
            allTotal={page.total}
            offerAlerts={Boolean(alerts && !alerts.leadAlerts && !alerts.optedOut)}
            chatsEmpty={chatsEmpty}
            addEnquiryFor={whatsapp ? { campaignId: whatsapp.id, spend: whatsapp.spend, enquiries: whatsapp.realEnquiries } : null}
            metaReady={metaConnection.ready}
            syncScope={`${business.owner_id}:${business.id}:${metaConnection.adAccountId ?? ""}:${metaConnection.pageId ?? ""}`}
            title={enquiriesTitle(chatRows)}
            summary={waitingPage || !summary?.waiting ? summary : { ...summary, waiting: null }}
            metaWaitUntil={metaConnection.ready ? await metaWaitFor(business.id) : null}
          />
        </EnquiriesSections>
      </div>
    </div>
  );
}
