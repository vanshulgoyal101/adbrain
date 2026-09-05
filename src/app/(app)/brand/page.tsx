import { BrandAssets } from "@/components/brand-assets";
import { BrandForm } from "@/components/brand-form";
import { Instructions } from "@/components/instructions";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  getAdInstructions,
  getBrandAssets,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const metadata = { title: "Brand Brain" };

export default async function BrandPage() {
  const business = await getPrimaryBusiness();
  const [assets, instructions] = business
    ? await Promise.all([
        getBrandAssets(business.id),
        getAdInstructions(business.id),
      ])
    : [[], []];

  return (
    <div>
      <PageHeader
        eyebrow="Workspace foundation"
        title="Brand Brain"
        description={
          <p>
          Your business memory for every ad. Keep the essentials here once, and
          AdBrain carries them into every creative and campaign.
          </p>
        }
      />
      {business && (
        <Card className="mt-6 border-blue-200 bg-[linear-gradient(110deg,#f4f8ff,#ffffff)]">
          <CardContent className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                Business
              </p>
              <p className="mt-1 font-semibold text-slate-950">{business.name}</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {business.vertical || "Local business"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                Service areas
              </p>
              <p className="mt-1 font-semibold text-slate-950">
                {business.locations.length || "No"} {business.locations.length === 1 ? "area" : "areas"}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                Used for local ad targeting
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                Creative guidance
              </p>
              <p className="mt-1 font-semibold text-slate-950">
                {business.usps.length + business.offers.length > 0 ? "Ready to use" : "Needs detail"}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                Offers and proof shape your ads
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      <nav
        aria-label="Brand Brain sections"
        className="mt-5 flex gap-2 overflow-x-auto border-y border-slate-200/80 py-2 text-sm"
      >
        {[
          ["Identity", "brand-identity"],
          ["Contact", "brand-contact"],
          ["Creative direction", "brand-creative"],
          ["Guidance", "brand-guidance"],
          ["Assets", "brand-assets"],
        ].map(([label, href]) => (
          <a
            key={href}
            href={`#${href}`}
            className="whitespace-nowrap rounded-lg px-3 py-2 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="mt-6 flex flex-col gap-6">
        <BrandForm business={business} />
        {business && (
          <>
            <section id="brand-guidance" className="scroll-mt-6">
              <Instructions
                businessId={business.id}
                instructions={instructions}
              />
            </section>
            <section id="brand-assets" className="scroll-mt-6">
              <BrandAssets businessId={business.id} initialAssets={assets} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
