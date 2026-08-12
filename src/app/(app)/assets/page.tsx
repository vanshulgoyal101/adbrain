import Link from "next/link";
import { Building2 } from "lucide-react";
import { AssetsLibrary } from "@/components/assets-library";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getBrandAssets,
  getCreatives,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Assets</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first — then everything you generate and
              upload lives here.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [creatives, brandAssets] = await Promise.all([
    getCreatives(business.id),
    getBrandAssets(business.id),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Assets</h1>
      <p className="mt-1 text-slate-600">
        Every image AdBrain generates for{" "}
        <span className="font-medium">{business.name}</span> is saved here — reuse,
        download, or share it any time.
      </p>
      <div className="mt-6">
        <AssetsLibrary creatives={creatives} brandAssets={brandAssets} />
      </div>
    </div>
  );
}
