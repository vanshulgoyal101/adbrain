import { metaWaitFor } from "@/services/meta-throttle";
import { reconnectByLabel } from "@/lib/meta/token-expiry";
import { requestWords, setupWords } from "@/i18n/request-locale";
import { Alert } from "@/components/ui/alert";
import { clientCreative } from "@/lib/creative/client-receipt";
import { madeForSetup } from "@/lib/creative/setup-picks";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Campaigns } from "@/components/campaigns";
import { SetupGoLive } from "@/components/setup-go-live";
import { setupWelcome } from "@/lib/campaign/setup-welcome";
import { BUDGET_PRESETS } from "@/lib/campaign/budget";
import { setupPhone } from "@/lib/brand/setup-fields";
import { maskWhatsAppNumber } from "@/lib/meta/whatsapp-status-shared";
import { fundingMode } from "@/lib/payments/operator-funding";
import { canUseMetaConnect, metaAppReviewPending } from "@/lib/meta/pilot-access";
import { adResultsEnabled } from "@/lib/campaign/ad-results-store";
import { ledgerTotals } from "@/lib/campaign/ledger";
import { draftDtoSchema, type DraftDTO } from "@/lib/campaign/connect-contracts";
import { listEditableDrafts } from "@/lib/campaign/draft-repository";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import { ReadyAdsNextStep } from "@/components/ready-ads-next-step";
import { isProspectSession } from "@/lib/prospect-session";
import { isInternalUser } from "@/lib/internal-accounts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  getMetaConnection,
} from "@/lib/meta/credentials";
import {
  getActiveCampaignBudgets,
  getApprovedCreatives,
  getCampaignPage,
  getLatestResultsWithEnquiries,
  getPrimaryBusiness,
  getSpendLimits,
} from "@/lib/supabase/queries";

export const metadata = { title: "Campaigns" };

/** #847: the owner's saved drafts in the first render, read as /api/campaign-drafts does; on any error the client loads them as before. */
async function savedDrafts(businessId: string): Promise<DraftDTO[] | undefined> {
  try {
    const actor = await requireOwnedBusiness(businessId);
    return draftDtoSchema.array().parse(await listEditableDrafts(await createClient(), actor));
  } catch {
    return undefined;
  }
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your business and generate some creatives first.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const campaignData = getCampaignPage(business.id).then(async (page) => ({
    ...page,
    results: await getLatestResultsWithEnquiries(page.campaigns.map((campaign) => campaign.id)),
  }));
  // #1342: the Settings cap and the live budgets, for the cap line; on error the line is left out and Activate still refuses.
  const spendCap = Promise.resolve()
    .then(() => Promise.all([getSpendLimits(business.id), getActiveCampaignBudgets(business.id)]))
    .then(([limits, active]) => ({ capRupees: limits.weeklyCapRupees, active }))
    .catch(() => null);
  const [approvedRows, page, connection, drafts, weeklyCap, ledger] = await Promise.all([
    getApprovedCreatives(business.id),
    campaignData,
    getMetaConnection(business.id),
    savedDrafts(business.id),
    spendCap,
    // #1307: Review's "What to expect" quotes AdBrain's pooled runs; unreadable keeps the recorded figures.
    ledgerTotals(),
  ]);
  const approved = approvedRows.map(clientCreative);
  const metaReady = connection.ready;
  const reconnectBy = connection.source === "oauth" && !connection.expired ? reconnectByLabel(connection.tokenExpiresAt) : null;
  const campaigns = page.campaigns;
  const requested = typeof params.creatives === "string" ? params.creatives.split(",") : [];
  // #1271: Go live's chip; only the offered amounts are taken from the address.
  const chosenBudget = BUDGET_PRESETS.find((amount) => String(amount) === params.budget);

  // #1271 (#1251 WS1 step 3): a first-timer with ready ads and no campaign yet gets Go live; `?all=1` opens this page.
  // Before App Review an owner who can't connect still gets ReadyAdsNextStep below (#336).
  const canConnect = async () => metaReady || await createClient().then((supabase) => supabase.auth.getUser())
    .then(({ data }) => Boolean(data.user && canUseMetaConnect(data.user.id))).catch(() => false);
  // #1934 (CPO #1924): a returning owner's "New campaign" ends here too, with Page and payment already done.
  const again = params.again === "1";
  if (params.all !== "1" && (again || !campaigns.length) && approved.length && await canConnect()) {
    // #1432: only ads made from today's step 1; with none, step 2 makes them.
    const current = approvedRows.filter((creative) => madeForSetup(creative, business)).map(clientCreative);
    if (!current.length) redirect(again ? "/create?again=1" : "/create");
    const picked = current.filter((creative) => requested.includes(creative.id));
    const ads = (picked.length ? picked : current).slice(0, 3);
    const funding = await fundingMode(business.id).catch(() => null);
    const masked = business.phone ? setupPhone(business.phone) : null;
    // #1529: the welcome Go live sends, from the same ad rows Review reads.
    const welcome = (() => {
      try { return setupWelcome(business, ads.flatMap((ad) => approvedRows.filter((row) => row.id === ad.id))); } catch { return null; }
    })();
    // #1934: the budget starts at the offered amount nearest the last campaign's.
    const last = [...campaigns].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const lastDaily = again && last?.daily_budget != null ? Number(last.daily_budget) : null;
    const initialDaily = lastDaily === null ? undefined
      : BUDGET_PRESETS.reduce((best, amount) => Math.abs(amount - lastDaily) < Math.abs(best - lastDaily) ? amount : best);
    return <SetupGoLive business={business} ads={ads} pageConnected={metaReady} funding={funding} returning={again} initialDaily={initialDaily}
      whatsappNumber={masked ? maskWhatsAppNumber(`+91${masked}`) : null} weeklyCap={weeklyCap} welcome={welcome} words={await setupWords()} appReviewPending={metaAppReviewPending()} />;
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Launch your approved ads on Meta, pause them and see what they bring in."
      />
      {/* #757: warn a week before the Facebook connection stops working, while managing still works. */}
      {reconnectBy && (
        <Alert variant="warning" className="mt-6">
          Reconnect Facebook by {reconnectBy} to keep managing your ads. <Link href="/settings" className="font-medium underline underline-offset-4">Open Settings</Link>
        </Alert>
      )}
      <div className="mt-6">
        {/* Before Meta's App Review a new owner can't connect, so the setup form would be a dead end (#336). */}
        {!metaReady && !campaigns.length && approved.length ? (
          <ReadyAdsNextStep approved={approved} phone={business.phone ?? null} businessId={business.id} sample={await isProspectSession()} />
        ) : <Campaigns
          business={business}
          approved={approved}
          initialCampaigns={campaigns}
          initialNextCursor={page.nextCursor}
          initialDrafts={drafts}
          initialResults={page.results}
          renderId={crypto.randomUUID()}
          leadForms={[]}
          leadFormError={null}
          metaReady={metaReady}
          adResults={adResultsEnabled()}
          whatsappLedger={ledger?.whatsapp ? { chats: ledger.whatsapp.results, spendRupees: ledger.whatsapp.spendRupees } : null}
          adAccountId={connection.adAccountId ?? ""}
          weeklyCap={weeklyCap}
          verdictWords={await requestWords("verdict")}
          campaignWords={await requestWords("campaigns")}
          metaWaitUntil={campaigns.some((campaign) => campaign.meta_campaign_id) ? await metaWaitFor(business.id) : null}
          newCampaign={params.new === "1" ? { creativeIds: requested, review: params.review === "1", budget: chosenBudget } : undefined}
          internal={await createClient().then((supabase) => supabase.auth.getUser()).then(({ data }) => isInternalUser(data.user)).catch(() => false)}
        />}
      </div>
    </div>
  );
}
