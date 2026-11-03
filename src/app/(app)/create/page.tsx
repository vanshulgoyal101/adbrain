import Link from "next/link";
import { requestWords, setupWords } from "@/i18n/request-locale";
import { createAdsTranslator } from "@/i18n/words";
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
import { brandDestination, brandUsable } from "@/lib/brand/usable";
import { clientCreative } from "@/lib/creative/client-receipt";
import { madeForSetup } from "@/lib/creative/setup-picks";
import { getApprovedCreatives, getBrandAssets, getSetupCreativeBatch, getPrimaryBusiness, hasLaunchedCampaign } from "@/lib/supabase/queries";
import { occasionsFor } from "@/lib/seasonal";
import { mediaUploadsEnabled, pickedMediaViews } from "@/lib/media/store";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Create ads",
  description:
    "Start with your customer goal and create campaign images and copy for review.",
};

export default async function CreatePage({ searchParams }: { searchParams?: Promise<{ all?: string | string[]; again?: string | string[]; photos?: string | string[] }> } = {}) {
  const [business, params, words] = await Promise.all([getPrimaryBusiness(), searchParams ?? ({} as { all?: string | string[]; again?: string | string[]; photos?: string | string[] }), requestWords("create")]);
  const t = createAdsTranslator(words), lang = words.locale === "en" ? undefined : words.locale;
  // #1934: a returning owner's "New campaign" runs step 2 again.
  const again = params.again === "1";

  if (!business) {
    return (
      <div>
        <h1 lang={lang} className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p lang={lang} className="max-w-md text-slate-600">{t("noBusiness")}</p>
            <Link href="/brand">
              <Button lang={lang}>{t("setUp")}</Button>
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
        if (launched && !again) return null;
        // #1432: ads made from an earlier step 1 aren't offered; step 2 makes new ones from today's.
        const ads = batch.ads.filter((ad) => madeForSetup(ad, business));
        // #1475: with earlier ads (older details, or made in Studio) the owner taps to start a paid batch; a failed
        // read counts as earlier, so nothing paid starts on its own.
        // #1934: a returning owner always counts as earlier; step 2 starts on arrival only from step 1's tap.
        const earlier = ads.length ? Promise.resolve(false) : again || batch.ads.length ? Promise.resolve(true)
          : getApprovedCreatives(business.id).then((approved) => approved.length > 0, () => true);
        // #1402: a "Make another" top-up shows beside its batch; the step checks the newest batch on arrival (#1407).
        return earlier.then((hasEarlier) => ({ ads: ads.map(clientCreative), earlier: hasEarlier }));
      }).catch(() => null);
    // #1272: the + button lands here; a first-timer without the five facts resumes at step 1.
    if (setup && !brandUsable({ ...business, vertical: setupFieldsFrom(business).vertical })) redirect(again ? "/brand?again=1" : "/brand");
    if (setup) return <SetupAdsStep business={business} initialAds={setup.ads} earlier={setup.earlier} again={again} sample={await isProspectSession()} words={await setupWords()} />;
  }

  const missing = [
    [business.offers?.length, t("missingOffers")],
    [business.locations?.length, t("missingAreas")],
    // #2646: a website business needs no phone; its link is checked by brandUsable instead.
    [business.phone || brandDestination(business) === "website", t("missingPhone")],
  ].filter(([present]) => !present).map(([, label]) => label);
  // #371: Create opens on what the business's own campaigns achieved; a failed read just skips the line.
  // #780 slice 2a: "Make ads from these" in the library; an unreadable pick just makes ads without it.
  const pickedIds = mediaUploadsEnabled() ? String(params.photos ?? "").split(",").filter(Boolean) : [];
  const [assets, evidence, photos] = await Promise.all([getBrandAssets(business.id), getResultEvidence(business.id).catch(() => []),
    pickedIds.length ? createClient().then((client) => pickedMediaViews(client, business.id, pickedIds)).catch(() => []) : []]);
  const hasPhotos = assets.some((a) => a.type === "product_photo");
  const visualsMissing = [!business.logo_url && t("logo"), !hasPhotos && t("photos")].filter(Boolean);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} lang={lang} />
      {/* #778 slice 3a: the entry choice (CPO #1868) as two equal rows (Designer, #1973 review 6). */}
      {mediaUploadsEnabled() && (
        <nav aria-label={t("howToMake")} lang={lang} className="mb-4 mt-4 grid max-w-2xl grid-cols-2 gap-2 text-sm">
          <a href="#create-flow" aria-current="page" className="inline-flex min-h-11 items-center justify-center rounded-md border border-primary bg-primary/10 px-3 text-center font-medium text-primary">{t("withAi")}</a>
          <Link href="/assets" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-3 text-center font-medium text-slate-700 hover:bg-slate-50">{t("myPhotos")}</Link>
        </nav>
      )}
      <div id="create-flow" className="scroll-mt-4">
      <CreateFlow business={business} opening={openingLine(evidence)} occasions={occasionsFor(business)} words={words} photos={photos}>
        <aside aria-label={t("details")} className="max-w-2xl border-t border-slate-200 pt-5 text-sm text-slate-500">
          <p>
            <span lang={lang}>{t("using", { name: business.name })}</span>{" "}
            <Link href="/brand" lang={lang} className="inline-flex min-h-11 items-center font-medium text-blue-700 underline-offset-2 hover:underline">{t("editBusiness")}</Link>
          </p>
          {missing.length > 0 && (
            <p lang={lang} className="mt-1">{t("missing", { items: missing.join(", ") })}</p>
          )}
          {visualsMissing.length > 0 && (
            <p lang={lang} className="mt-1">
              {t("visuals", { items: visualsMissing.join(t("and")) })}{" "}
              <Link href="/brand#brand-assets" className="font-medium text-blue-700 underline-offset-2 hover:underline">{t("addPhotos")}</Link>{" "}
              {t("skip")}
            </p>
          )}
        </aside>
      </CreateFlow>
      </div>
    </div>
  );
}
