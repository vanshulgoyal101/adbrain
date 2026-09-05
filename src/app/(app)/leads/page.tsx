import { Building2 } from "lucide-react";
import Link from "next/link";
import { LeadInbox } from "@/components/lead-inbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isMetaConfigured } from "@/lib/meta/client";
import { getLeads, getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const business = await getPrimaryBusiness();
  const metaReady = isMetaConfigured();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
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

  const leads = await getLeads(business.id);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
      <p className="mt-1 text-slate-600">
        Everyone who filled your Meta lead forms, in one inbox — with a
        ready-to-send WhatsApp digest.
      </p>
      <div className="mt-6">
        <LeadInbox
          businessName={business.name}
          initialLeads={leads}
          metaReady={metaReady}
        />
      </div>
    </div>
  );
}
