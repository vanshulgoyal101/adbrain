import { Building2 } from "lucide-react";
import Link from "next/link";
import { LeadInbox } from "@/components/lead-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getMetaConnection } from "@/lib/meta/credentials";
import { getLeads, getPrimaryBusiness } from "@/lib/supabase/queries";

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
              Set up your Brand Brain and launch a campaign first — leads will
              land here.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [leads, metaConnection] = await Promise.all([
    getLeads(business.id),
    getMetaConnection(business.id),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Customer conversations"
        title="Enquiries"
        description="People who responded to your campaigns. Find their details and make the next conversation count."
      />
      <div className="mt-6">
        <LeadInbox
          businessName={business.name}
          initialLeads={leads}
          metaReady={metaConnection.ready}
        />
      </div>
    </div>
  );
}
