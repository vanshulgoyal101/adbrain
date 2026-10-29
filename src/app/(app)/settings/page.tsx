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
import { SpendGuardrails } from "@/components/spend-guardrails";
import { PreferenceSettings } from "@/components/preference-settings";
import { PrivacyRequests } from "@/components/privacy-requests";
import { WhatsAppAlerts } from "@/components/whatsapp-alerts";
import { AppLanguage } from "@/components/app-language";
import { translator } from "@/i18n/locale";
import { requestLocale } from "@/i18n/request-locale";
import { readAlertSettings } from "@/lib/alerts/settings-read";
import { WhatsAppStatusSection } from "@/components/whatsapp-status-section";
import { MetaSetupChecklist } from "@/components/meta-setup-checklist";
import { setupChecklistEnabled } from "@/lib/meta/setup-checklist";
import { readSetupChecklist } from "@/lib/meta/setup-status";
import { getMetaConnection } from "@/lib/meta/credentials";
import { metaOAuthConfigured } from "@/lib/meta/oauth";
import { createClient } from "@/lib/supabase/server";
import { getApprovedCreatives, getPrimaryBusiness, getSpendEvaluation } from "@/lib/supabase/queries";
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

export const metadata = { title: "Settings" };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Facebook Login isn't configured on this server yet.",
  no_business: "Set up your business before connecting Meta.",
  invalid_state: "That connection link expired. Please try connecting again.",
  connect_failed: "Couldn't complete the connection. Please try again.",
  access_denied: "You declined the permissions AdBrain needs to manage ads.",
};

function noticeFrom(
  params: Record<string, string | string[] | undefined>,
): { kind: "success" | "error"; message: string } | undefined {
  if (params.meta_connected) {
    return { kind: "success", message: "Your Meta account is connected." };
  }
  if (params.meta_select) {
    return {
      kind: "success",
      message: "Connected. Now choose your ad account and page below.",
    };
  }
  const err = params.meta_error;
  if (typeof err === "string") {
    return { kind: "error", message: ERROR_MESSAGES[err] ?? err };
  }
  return undefined;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your business first, then connect your ad account here.
            </p>
            <Link href="/brand">
              <Button>Set up your business</Button>
            </Link>
          </CardContent>
        </Card>
        <div className="mt-6"><PrivacyRequests /></div>
      </div>
    );
  }

  return (
    // #403 S5: one column up to xl; from xl, connections and money left, limits and preferences right.
    <div className="max-w-2xl space-y-6 xl:max-w-6xl">
      <PageHeader
        title="Settings"
        description="Your Meta connection, spending limits and data."
      />
      {/* #1670: a sales prospect account hands its prepared business to the owner; nothing renders for owners. */}
      <Suspense fallback={null}>
        <ProspectHandOverSection businessId={business.id} businessName={business.name} />
      </Suspense>
      <div className="space-y-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6 xl:space-y-0">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<SettingsLoading label="Meta connection" />}>
            {/* #847: WhatsApp sits with the Meta connection it depends on, above Billing. */}
            <ConnectionSettings businessId={business.id} searchParams={searchParams} whatsapp={
              <Suspense fallback={<SettingsLoading label="WhatsApp chat ads" />}>
                <WhatsAppStatusSection businessId={business.id} />
              </Suspense>
            } />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<SettingsLoading label="Spend guardrails" />}>
            <SpendSettings businessId={business.id} />
          </Suspense>
          <Suspense fallback={<SettingsLoading label="Preferences" />}>
            <PreferenceAndPrivacySettings businessId={business.id} />
          </Suspense>
        </div>
      </div>
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
  return <>
    {/* #1438: Home follows this choice; other screens follow screen by screen. */}
    <AppLanguage key={locale} initial={locale} labels={{ language: t("language"), hint: t("languageHint"), saveFailed: t("saveFailed") }} />
    {/* #701: shown once AdBrain's alerts number is set (ALERTS_WHATSAPP). */}
    {alerts && <WhatsAppAlerts businessId={businessId} initial={alerts} locale={locale} />}
    <PreferenceSettings key={businessId} businessId={businessId} initialState={preferences} />
    <PrivacyRequests initialRequests={requests} initialOperatorAvailable={operator} />
  </>;
}

function SettingsLoading({ label }: { label: string }) {
  return <section role="status" aria-label={`Loading ${label}`} className="min-h-64 space-y-5 rounded-lg border border-slate-200 bg-white p-6">
    <h2 className="font-semibold text-slate-900">{label}</h2>
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
      <div className="h-4 w-3/4 rounded bg-slate-100" />
      <div className="h-10 rounded bg-slate-100" />
      <div className="h-10 w-32 rounded bg-slate-100" />
    </div>
  </section>;
}

async function ConnectionSettings({ businessId, searchParams, whatsapp }: {
  businessId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  whatsapp: ReactNode;
}) {
  // #759: payment shows only where AdBrain holds ad money; an unreadable mode shows none.
  const mode = await fundingMode(businessId).catch(() => null);
  const [result, params, initialBalance, locale] = await Promise.all([
    getMetaConnection(businessId).then(connection => ({ connection })).catch(() => ({ connection: null })),
    searchParams,
    mode === "managed" && isProductionPaymentConfigured()
      ? requireOwnedBusiness(businessId).then(getCustomerBalance).then(toCustomerBalanceView).catch(() => null)
      : Promise.resolve(null),
    requestLocale(),
  ]);
  return (
    <>
      {result.connection ? (
        <MetaConnectionPanel businessId={businessId} connection={result.connection}
          oauthConfigured={metaOAuthConfigured()} notice={noticeFrom(params)} fundingMode={mode} locale={locale} />
      ) : (
        <Alert variant="error">
          Meta connection status is temporarily unavailable. Your campaign draft is preserved.
          <Link href="/settings" className="ml-1 font-medium underline">Try again</Link>
        </Alert>
      )}
      {/* #1016: behind META_SETUP_CHECKLIST; only for the owner's own Meta account, after Connect. */}
      {setupChecklistEnabled() && mode !== "managed" && result.connection?.source === "oauth" && result.connection.ready && (
        <Suspense fallback={<SettingsLoading label="Ready to launch on Meta" />}>
          <SetupChecklistSection businessId={businessId} />
        </Suspense>
      )}
      {whatsapp}
      <BillingSection mode={mode} locale={locale} connection={result.connection} testBusinessId={isRazorpayTestEnabled() ? businessId : undefined}
        liveBusinessId={isProductionPaymentConfigured() ? businessId : undefined} initialBalance={initialBalance}
        billingTab={typeof params.billing === "string" ? params.billing : null} />
    </>
  );
}

async function SetupChecklistSection({ businessId }: { businessId: string }) {
  const rows = await readSetupChecklist(businessId).catch(() => null);
  return <MetaSetupChecklist rows={rows} />;
}

async function SpendSettings({ businessId }: { businessId: string }) {
  const spend = await getSpendEvaluation(businessId).catch(() => null);
  return spend ? <SpendGuardrails limits={spend.limits} evaluation={spend.evaluation} /> : (
    <Alert variant="error">
      Spend limits could not be loaded. Your saved limits have not changed.
      <Link href="/settings" className="ml-1 font-medium underline">Try again</Link>
    </Alert>
  );
}
