import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { AdAssistant } from "@/components/ad-assistant";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = {
  title: "Create marketing",
  description:
    "Start with your customer goal and create campaign images and copy for review.",
};

export default async function CreatePage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Create marketing</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first — the assistant uses it to make
              marketing that reflects your business.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Create"
        title="Create marketing"
        description="Who do you want to reach? Start with your customer goal, then create images and copy to review before building a campaign."
      />
      <div className="mt-7 grid gap-8 border-t border-slate-200 pt-7 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <AdAssistant business={business} />
        <aside aria-label="Saved brand context" className="min-w-0 border-t border-slate-200 pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-xs font-medium text-slate-500">Brand context</p>
          <h2 className="mt-2 font-semibold text-slate-900">{business.name}</h2>
          <dl className="mt-5 space-y-5 text-sm">
            {[["Voice", business.brand_voice], ["Audience", business.target_audience], ["Service areas", business.locations.join(", ")]].map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-slate-400">{label}</dt><dd className="break-words leading-6 text-slate-600">{value || "Not added"}</dd></div>)}
          </dl>
          <Link href="/brand" className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700">Edit Brand Brain <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </aside>
      </div>
    </div>
  );
}
