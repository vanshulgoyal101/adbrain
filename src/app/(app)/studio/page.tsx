import Link from "next/link";
import { Building2 } from "lucide-react";
import { Studio } from "@/components/studio";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCreatives, getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = { title: "Creative Studio" };

export default async function StudioPage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Creative Studio</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first — the studio uses it to write
              on-brand ads.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const creatives = await getCreatives(business.id);

  return (
    <div>
      <PageHeader
        eyebrow="Workbench"
        title="Creative Studio"
        description={
          <p>
            Turn a business goal into on-brand ads for <span className="font-medium">{business.name}</span>,
            then review the variants worth taking to launch.
          </p>
        }
      />
      <div className="mt-6">
        <Studio business={business} initialCreatives={creatives} />
      </div>
    </div>
  );
}
