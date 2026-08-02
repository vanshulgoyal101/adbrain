import { BrandAssets } from "@/components/brand-assets";
import { BrandForm } from "@/components/brand-form";
import { Instructions } from "@/components/instructions";
import {
  getAdInstructions,
  getBrandAssets,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const metadata = { title: "Brand Brain — AdBrain" };

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
      <h1 className="text-2xl font-bold text-slate-900">Brand Brain</h1>
      <p className="mt-1 text-slate-600">
        The context AdBrain uses to write on-brand ads. The more you fill in,
        the better the creatives.
      </p>
      <div className="mt-6 flex flex-col gap-6">
        <BrandForm business={business} />
        {business && (
          <>
            <Instructions
              businessId={business.id}
              instructions={instructions}
            />
            <BrandAssets businessId={business.id} initialAssets={assets} />
          </>
        )}
      </div>
    </div>
  );
}
