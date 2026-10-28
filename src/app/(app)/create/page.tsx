import Link from "next/link";
import { Building2 } from "lucide-react";
import { openingLine } from "@/lib/campaign/result-evidence";
import { getResultEvidence } from "@/lib/campaign/result-evidence-store";
import { CreateFlow } from "@/components/create-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { redirect } from "next/navigation";
import { SetupAdsStep } from "@/components/setup-ads-step";
import { isProspectSession } from "@/lib/prospect-session";
import { setupFieldsFrom } from "@/lib/brand/setup-fields";
import { brandUsable } from "@/lib/brand/usable";
import { clientCreative } from "@/lib/creative/client-receipt";
import { madeForSetup } from "@/lib/creative/setup-picks";
import { getApprovedCreatives, getBrandAssets, getSetupCreativeBatch, getPrimaryBusiness, hasLaunchedCampaign } from "@/lib/supabase/queries";
import { occasionsFor } from "@/lib/seasonal";

export const metadata = {
  title: "Create ads",
  description:
    "Start with your customer goal and create campaign images and copy for review.",
};

export default async function CreatePage({ searchParams }: { searchParams?: Promise<{ all?: string | string[] }> } = {}) {
  const [business, params] = await Promise.all([getPrimaryBusiness(), searchParams ?? ({} as { all?: string | string[] })]);

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
              Set up your business first: the assistant uses it to make
              ads that reflect your business.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // #1270 (#1251 WS1 step 2): until a first campaign has gone live, Create is the guided "Your ads" step;
  // `?all=1` opens the full Create. If either read fails, the full Create shows as before.
  if (params.all !== "1") {
    const setup = await Promise.resolve()
      .then(() => Promise.all([hasLaunchedCampaign(business.id), getSetupCreativeBatch(business.id)]))
      .then(([launched, batch]) => {
        if (launched) return null;
        // #1432: ads made from an earlier step 1 aren't offered; step 2 makes new ones from today's.
        const ads = batch.ads.filter((ad) => madeForSetup(ad, business));
        // #1475: with earlier ads (older details, or made in Studio) the owner taps to start a paid batch; a failed
        // read counts as earlier, so nothing paid starts on its own.
        const earlier = ads.length ? Promise.resolve(false) : batch.ads.length ? Promise.resolve(true)
          : getApprovedCreatives(business.id).then((approved) => approved.length > 0, () => true);
        // #1402: a "Make another" top-up shows beside its batch; the step checks the newest batch on arrival (#1407).
        return earlier.then((hasEarlier) => ({ ads: ads.map(clientCreative), earlier: hasEarlier }));
      }).catch(() => null);
    // #1272: the + button lands here; a first-timer without the five facts resumes at step 1.
    if (setup && !brandUsable({ ...business, vertical: setupFieldsFrom(business).vertical })) redirect("/brand");
    if (setup) return <SetupAdsStep business={business} initialAds={setup.ads} earlier={setup.earlier} sample={await isProspectSession()} />;
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
        description="Say who you want to reach. You check every ad before it runs."
      />
      <CreateFlow business={business} opening={openingLine(evidence)} occasions={occasionsFor(business)}>
        <aside aria-label="Your business details" className="max-w-2xl border-t border-slate-200 pt-5 text-sm text-slate-500">
          <p>
            Using {business.name}&apos;s details.{" "}
            <Link href="/brand" className="inline-flex min-h-11 items-center font-medium text-blue-700 underline-offset-2 hover:underline">Edit your business</Link>
          </p>
          {missing.length > 0 && (
            <p className="mt-1">Not added yet: {missing.join(", ")}. Ads leave these out.</p>
          )}
          {visualsMissing.length > 0 && (
            <p className="mt-1">
              Add {visualsMissing.join(" and ")} so ads look like your business.{" "}
              <Link href="/brand#brand-assets" className="font-medium text-blue-700 underline-offset-2 hover:underline">Add photos</Link>{" "}
              or skip for now.
            </p>
          )}
        </aside>
      </CreateFlow>
    </div>
  );
}
