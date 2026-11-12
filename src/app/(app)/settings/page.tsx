import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Building2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MetaConnectionPanel } from "@/components/meta-connection";
import { BillingSection } from "@/components/managed-billing";
import { fundingMode } from "@/lib/payments/operator-funding";
import { isPlanBillingEnabled, readPlan } from "@/lib/plan/store";
import { SpendGuardrails } from "@/components/spend-guardrails";
import { PreferenceSettings } from "@/components/preference-settings";
import { PrivacyRequests } from "@/components/privacy-requests";
import { WhatsAppAlerts } from "@/components/whatsapp-alerts";
import { AppLanguage } from "@/components/app-language";
import { namespaceMessages, translator, type AppLocale } from "@/i18n/locale";
import { requestLocale } from "@/i18n/request-locale";
import { readAlertSettings } from "@/lib/alerts/settings-read";
import { WhatsAppStatusSection } from "@/components/whatsapp-status-section";
import { MetaSetupChecklist } from "@/components/meta-setup-checklist";
import { setupChecklistEnabled } from "@/lib/meta/setup-checklist";
import { readSetupChecklist } from "@/lib/meta/setup-status";
import { getMetaConnection } from "@/lib/meta/credentials";
import { metaOAuthConfigured } from "@/lib/meta/oauth";
import { createClient } from "@/lib/supabase/server";
import { getApprovedCreatives, getCampaigns, getPrimaryBusiness, getSpendEvaluation } from "@/lib/supabase/queries";
import { pausableCampaigns } from "@/lib/campaign/gone-in-meta";
import { ProspectHandOver } from "@/components/prospect-hand-over";
import { isProspectAccount } from "@/lib/internal-accounts";
import { transferChecks } from "@/lib/prospect/transfer";
import { repTransferState } from "@/lib/prospect/transfer-server";
import { isRazorpayTestEnabled } from "@/lib/payments/razorpay-test";
import { isProductionPaymentConfigured } from "@/lib/payments/production-config";
import { getCustomerBalance } from "@/lib/payments/customer-balance";
import { toCustomerBalanceView } from "@/lib/payments/customer-balance-contracts";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { readPreferenceState } from "@/lib/preferences/store";
import { listOwnPrivacyRequests, privacyOperatorAllowed } from "@/lib/privacy-requests";
import { SettingsColumns, SettingsLoading } from "./settings-layout";

export const metadata = { title: "Settings" };

const META_ERRORS = ["not_configured", "no_business", "invalid_state", "connect_failed", "access_denied"] as const;

function noticeFrom(
  params: Record<string, string | string[] | undefined>,
  locale: AppLocale,
): { kind: "success" | "error"; message: string } | undefined {
  const t = translator(locale, "settings");
  if (params.meta_connected) return { kind: "success", message: t("meta.noticeConnected") };
  if (params.meta_select) return { kind: "success", message: t("meta.noticeSelect") };
  const err = params.meta_error;
  if (typeof err === "string") {
    const known = META_ERRORS.find((key) => key === err);
    return { kind: "error", message: known ? t(`meta.error.${known}`) : err };
  }
  return undefined;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [business, locale] = await Promise.all([getPrimaryBusiness(), requestLocale()]);
  const t = translator(locale, "settings");

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("page.title")}</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              {t("page.noBusiness")}
            </p>
            <Link href="/brand">
              <Button>{t("page.setUpBusiness")}</Button>
            </Link>
          </CardContent>
        </Card>
        <div className="mt-6"><PrivacyRequests words={{ locale, messages: namespaceMessages(locale, "settings") }} /></div>
      </div>
    );
  }

  return (
    // #403 S5: one column up to xl; from xl, connections and money left, limits and preferences right.
    <div className="max-w-2xl space-y-6 xl:max-w-6xl">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />
      {/* #1670: a sales prospect account hands its prepared business to the owner; nothing renders for owners. */}
      <Suspense fallback={null}>
        <ProspectHandOverSection businessId={business.id} businessName={business.name} />
      </Suspense>
      <SettingsColumns
        primary={<Suspense fallback={<SettingsLoading label={t("meta.title")} status={t("page.loading", { label: t("meta.title") })} primary />}>
          {/* #847: WhatsApp sits with the Meta connection it depends on, above Billing. */}
          <ConnectionSettings businessId={business.id} searchParams={searchParams} whatsapp={
            <Suspense fallback={<SettingsLoading label={t("whatsappStatus.title")} status={t("page.loading", { label: t("whatsappStatus.title") })} primary />}>
              <WhatsAppStatusSection businessId={business.id} />
            </Suspense>
          } />
        </Suspense>}
        secondary={<>
          <Suspense fallback={<SettingsLoading label={t("spend.title")} status={t("page.loading", { label: t("spend.title") })} tall />}>
            <SpendSettings businessId={business.id} />
          </Suspense>
          <Suspense fallback={<SettingsLoading label={t("page.preferences")} status={t("page.loading", { label: t("page.preferences") })} />}>
            <PreferenceAndPrivacySettings businessId={business.id} />
          </Suspense>
        </>}
      />
    </div>
  );
}

async function ProspectHandOverSection({ businessId, businessName }: { businessId: string; businessName: string }) {
  const user = await createClient().then((supabase) => supabase.auth.getUser()).then(({ data }) => data.user, () => null);
  if (!isProspectAccount(user)) return null;
  const [state, approved] = await Promise.all([repTransferState(businessId).catch(() => null), getApprovedCreatives(businessId).catch(() => [])]);
  if (!state) return <Alert variant="error">The hand-over couldn&apos;t be loaded. Refresh to try again.</Alert>;
  return <ProspectHandOver businessId={businessId} businessName={businessName} ads={approved.length} checks={transferChecks(state.blocker)} latest={state.latest} />;
}

// #238: read once in the server render; the panels refetch only after the owner acts.
async function PreferenceAndPrivacySettings({ businessId }: { businessId: string }) {
  const [locale, preferences, requests, operator, alerts] = await Promise.all([
    requestLocale(),
    readPreferenceState(businessId).catch(() => null),
    listOwnPrivacyRequests().catch(() => null),
    privacyOperatorAllowed().catch(() => false),
    readAlertSettings(businessId).catch(() => null),
  ]);
  const t = translator(locale, "settings");
  const words = { locale, messages: namespaceMessages(locale, "settings") };
  return <>
    {/* #1438: Home follows this choice; other screens follow screen by screen. */}
    <AppLanguage key={locale} initial={locale} labels={{ language: t("language"), hint: t("languageHint"), saveFailed: t("saveFailed") }} />
    {/* #701: shown once AdBrain's alerts number is set (ALERTS_WHATSAPP). */}
    {alerts && <WhatsAppAlerts businessId={businessId} initial={alerts} locale={locale} />}
    <PreferenceSettings key={businessId} businessId={businessId} initialState={preferences} words={words} />
    <PrivacyRequests initialRequests={requests} initialOperatorAvailable={operator} words={words} />
  </>;
}

async function ConnectionSettings({ businessId, searchParams, whatsapp }: {
  businessId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  whatsapp: ReactNode;
}) {
  // #759: payment shows only where AdBrain holds ad money; an unreadable mode shows none.
  const mode = await fundingMode(businessId).catch(() => null);
  // #718 slice 2: an own-account owner's ₹999 plan (off until PLAN_BILLING_ENABLED); a read failure just hides it.
  const plan = mode === "own" && isPlanBillingEnabled() ? await readPlan(businessId).catch(() => null) : null;
  const [result, params, initialBalance, locale, campaigns] = await Promise.all([
    getMetaConnection(businessId).then(connection => ({ connection })).catch(() => ({ connection: null })),
    searchParams,
    mode === "managed" && isProductionPaymentConfigured()
      ? requireOwnedBusiness(businessId).then(getCustomerBalance).then(toCustomerBalanceView).catch(() => null)
      : Promise.resolve(null),
    requestLocale(),
    // #1968: Pause all sits under "If you stop", which only an own-account owner sees.
    mode === "own" ? getCampaigns(businessId).catch(() => []) : Promise.resolve([]),
  ]);
  const t = translator(locale, "settings");
  return (
    <>
      {result.connection ? (
        <MetaConnectionPanel businessId={businessId} connection={result.connection}
          oauthConfigured={metaOAuthConfigured()} notice={noticeFrom(params, locale)} fundingMode={mode} locale={locale} />
      ) : (
        <Alert variant="error">
          {t("meta.unavailable")}
          <Link href="/settings" className="ml-1 font-medium underline">{t("page.tryAgain")}</Link>
        </Alert>
      )}
      {/* #1016: behind META_SETUP_CHECKLIST; only for the owner's own Meta account, after Connect. */}
      {setupChecklistEnabled() && mode !== "managed" && result.connection?.source === "oauth" && result.connection.ready && (
        <Suspense fallback={<SettingsLoading label={t("metaSetup.title")} primary />}>
          <SetupChecklistSection businessId={businessId} locale={locale} />
        </Suspense>
      )}
      {whatsapp}
      <BillingSection mode={mode} locale={locale} runningCampaigns={pausableCampaigns(campaigns)} connection={result.connection} testBusinessId={isRazorpayTestEnabled() ? businessId : undefined}
        liveBusinessId={isProductionPaymentConfigured() ? businessId : undefined} initialBalance={initialBalance}
        plan={plan} planBusinessId={businessId}
        billingTab={typeof params.billing === "string" ? params.billing : null} />
    </>
  );
}

async function SetupChecklistSection({ businessId, locale }: { businessId: string; locale: AppLocale }) {
  const rows = await readSetupChecklist(businessId).catch(() => null);
  return <MetaSetupChecklist rows={rows} locale={locale} />;
}

async function SpendSettings({ businessId }: { businessId: string }) {
  const [spend, locale] = await Promise.all([getSpendEvaluation(businessId).catch(() => null), requestLocale()]);
  const t = translator(locale, "settings");
  return spend ? <SpendGuardrails limits={spend.limits} evaluation={spend.evaluation} words={{ locale, messages: namespaceMessages(locale, "settings") }} /> : (
    <Alert variant="error">
      {t("spend.loadFailed")}
      <Link href="/settings" className="ml-1 font-medium underline">{t("page.tryAgain")}</Link>
    </Alert>
  );
}
