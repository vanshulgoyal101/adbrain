import { BrandForm } from "@/components/brand-form";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export default async function BrandPage() {
  const business = await getPrimaryBusiness();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Brand Brain</h1>
      <p className="mt-1 text-slate-600">
        The context AdBrain uses to write on-brand ads. The more you fill in,
        the better the creatives.
      </p>
      <div className="mt-6">
        <BrandForm business={business} />
      </div>
    </div>
  );
}
