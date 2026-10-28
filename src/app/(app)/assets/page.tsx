import Link from "next/link";
import { Building2 } from "lucide-react";
import { AssetsLibrary } from "@/components/assets-library";
import { MediaLibrary } from "@/components/media-library";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  getBrandAssets,
  getCreativePreviews,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";
import { isProspectSession } from "@/lib/prospect-session";
import { listMedia, mediaUploadsEnabled } from "@/lib/media/store";
import { createClient } from "@/lib/supabase/server";

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
              Set up your business first. Every ad you make and every photo you
              upload is saved here.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [creatives, brandAssets, sample] = await Promise.all([
    getCreativePreviews(business.id),
    getBrandAssets(business.id),
    isProspectSession(),
  ]);

  // #778 slice 3a: with uploads on, the page is the owner's photo library; a failed read shows the empty state.
  if (mediaUploadsEnabled()) {
    const media = await createClient()
      .then((client) => listMedia(client, business.id))
      .then((page) => page.items, () => []);
    return (
      <div>
        <PageHeader title="Photos & videos" description={<p>Your own photos for {business.name}&apos;s ads, and every ad AdBrain made.</p>} />
        <div className="mt-6">
          <MediaLibrary media={media} creatives={creatives} brandAssets={brandAssets} sample={sample} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Assets"
        description={
          <p>Every ad and upload for {business.name}, {sample ? "kept here until the account is handed over (sample ads can\u2019t be downloaded)." : "ready to download or share."}</p>
        }
      />
      <div className="mt-6">
        <AssetsLibrary creatives={creatives} brandAssets={brandAssets} sample={sample} />
      </div>
    </div>
  );
}
