import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { openingLine } from "@/lib/campaign/result-evidence";
import { getResultEvidence } from "@/lib/campaign/result-evidence-store";
import { CreateFlow } from "@/components/create-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getBrandAssets, getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = {
  title: "Create ads",
  description:
    "Start with your customer goal and create campaign images and copy for review.",
};

export default async function CreatePage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Create ads</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first: the assistant uses it to make
              ads that reflect your business.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const missing = [
    [business.offers?.length, "offers or prices"],
    [business.locations?.length, "service areas"],
    [business.phone, "phone number"],
  ].filter(([present]) => !present).map(([, label]) => label);
  // #371: Create opens on what the business's own campaigns achieved; a failed read just skips the line.
  const [assets, evidence] = await Promise.all([getBrandAssets(business.id), getResultEvidence(business.id).catch(() => [])]);
  const hasPhotos = assets.some((a) => a.type === "product_photo");
  const visualsMissing = [!business.logo_url && "your logo", !hasPhotos && "1–3 real photos (team, premises or finished work)"].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Create ads"
        description="Who do you want to reach? Start with your customer goal; you review every ad before a campaign."
      />
      <CreateFlow business={business} opening={openingLine(evidence)}>
        <aside aria-label="Saved brand context" className="min-w-0 border-t border-slate-200 pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-xs font-medium text-slate-500">Brand context</p>
          <h2 className="mt-2 font-semibold text-slate-900">{business.name}</h2>
          <dl className="mt-5 space-y-5 text-sm">
            {[["Voice", business.brand_voice], ["Audience", business.target_audience], ["Offers", (business.offers ?? []).join(", ")], ["Service areas", (business.locations ?? []).join(", ")], ["Phone", business.phone]].map(([label, value]) => <div key={label}><dt className="mb-1 text-xs text-slate-400">{label}</dt><dd className="break-words leading-6 text-slate-600">{value || "Not added"}</dd></div>)}
          </dl>
          {missing.length > 0 && (
            <p className="mt-5 text-sm leading-6 text-amber-800">
              Not in your Brand yet: {missing.join(", ")}. Ads only state facts your Brand has, so they will leave these out.
            </p>
          )}
          {visualsMissing.length > 0 && (
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Add {visualsMissing.join(" and ")} so ads look like your business.{" "}
              <Link href="/brand#brand-assets" className="font-medium text-blue-700 underline-offset-2 hover:underline">Add photos</Link>{" "}
              or skip for now.
            </p>
          )}
          <Link href="/brand" className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700">Edit Brand Brain <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </aside>
      </CreateFlow>
    </div>
  );
}
