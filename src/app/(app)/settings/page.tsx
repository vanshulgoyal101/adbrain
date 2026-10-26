import Link from "next/link";
import { Suspense } from "react";
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
import { WhatsAppStatusSection } from "@/components/whatsapp-status-section";
import { getMetaConnection } from "@/lib/meta/credentials";
import { metaOAuthConfigured } from "@/lib/meta/oauth";
import { getPrimaryBusiness, getSpendEvaluation } from "@/lib/supabase/queries";
import { isRazorpayTestEnabled } from "@/lib/payments/razorpay-test";
import { isProductionPaymentConfigured } from "@/lib/payments/production-config";
import { getCustomerBalance } from "@/lib/payments/customer-balance";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { readPreferenceState } from "@/lib/preferences/store";
import { listOwnPrivacyRequests, privacyOperatorAllowed } from "@/lib/privacy-requests";

export const metadata = { title: "Settings" };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Facebook Login isn't configured on this server yet.",
  no_business: "Set up your Brand Brain before connecting Meta.",
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
              Set up your Brand Brain first, then connect your ad account here.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
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
        description="Manage publishing connections and the safety limits that protect your advertising budget."
      />
      <div className="space-y-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-6 xl:space-y-0">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<SettingsLoading label="Meta connection" />}>
            <ConnectionSettings businessId={business.id} searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={<SettingsLoading label="WhatsApp chat ads" />}>
            <WhatsAppStatusSection businessId={business.id} />
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

// #238: read once in the server render; the panels refetch only after the owner acts.
async function PreferenceAndPrivacySettings({ businessId }: { businessId: string }) {
  const [preferences, requests, operator] = await Promise.all([
    readPreferenceState(businessId).catch(() => null),
    listOwnPrivacyRequests().catch(() => null),
    privacyOperatorAllowed().catch(() => false),
  ]);
  return <>
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

async function ConnectionSettings({ businessId, searchParams }: {
  businessId: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // #759: payment shows only where AdBrain holds ad money; an unreadable mode shows none.
  const mode = await fundingMode(businessId).catch(() => null);
  const [result, params, initialBalance] = await Promise.all([
    getMetaConnection(businessId).then(connection => ({ connection })).catch(() => ({ connection: null })),
    searchParams,
    mode === "managed" && isProductionPaymentConfigured()
      ? requireOwnedBusiness(businessId).then(getCustomerBalance).catch(() => null)
      : Promise.resolve(null),
  ]);
  return (
    <>
      {result.connection ? (
        <MetaConnectionPanel businessId={businessId} connection={result.connection}
          oauthConfigured={metaOAuthConfigured()} notice={noticeFrom(params)} />
      ) : (
        <Alert variant="error">
          Meta connection status is temporarily unavailable. Your campaign draft is preserved.
          <Link href="/settings" className="ml-1 font-medium underline">Try again</Link>
        </Alert>
      )}
      <BillingSection mode={mode} connection={result.connection} testBusinessId={isRazorpayTestEnabled() ? businessId : undefined}
        liveBusinessId={isProductionPaymentConfigured() ? businessId : undefined} initialBalance={initialBalance} />
    </>
  );
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
