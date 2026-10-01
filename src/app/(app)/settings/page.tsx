import Link from "next/link";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MetaConnectionPanel } from "@/components/meta-connection";
import { ManagedBilling } from "@/components/managed-billing";
import { SpendGuardrails } from "@/components/spend-guardrails";
import { getMetaConnection } from "@/lib/meta/credentials";
import { metaOAuthConfigured } from "@/lib/meta/oauth";
import { getPrimaryBusiness, getSpendEvaluation } from "@/lib/supabase/queries";
import { isRazorpayTestEnabled } from "@/lib/payments/razorpay-test";
import { isProductionPaymentConfigured } from "@/lib/payments/production-config";

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
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Manage publishing connections and the safety limits that protect your advertising budget."
      />
      <Suspense fallback={<SettingsLoading label="Meta connection" />}>
        <ConnectionSettings businessId={business.id} searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SettingsLoading label="Spend guardrails" />}>
        <SpendSettings businessId={business.id} />
      </Suspense>
    </div>
  );
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
  const [result, params] = await Promise.all([
    getMetaConnection(businessId).then(connection => ({ connection })).catch(() => ({ connection: null })),
    searchParams,
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
      <ManagedBilling connection={result.connection} testBusinessId={isRazorpayTestEnabled() ? businessId : undefined}
        liveBusinessId={isProductionPaymentConfigured() ? businessId : undefined} />
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
