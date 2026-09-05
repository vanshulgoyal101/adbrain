import Link from "next/link";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MetaConnectionPanel } from "@/components/meta-connection";
import { SpendGuardrails } from "@/components/spend-guardrails";
import { getMetaConnection } from "@/lib/meta/credentials";
import { metaOAuthConfigured } from "@/lib/meta/oauth";
import { getPrimaryBusiness, getSpendEvaluation } from "@/lib/supabase/queries";

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

  const [connection, params, spend] = await Promise.all([
    getMetaConnection(business.id),
    searchParams,
    getSpendEvaluation(business.id),
  ]);
  const { limits, evaluation } = spend;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-slate-600">
          Connect the accounts AdBrain uses to publish and manage your ads.
        </p>
      </div>
      <MetaConnectionPanel
        connection={connection}
        oauthConfigured={metaOAuthConfigured()}
        notice={noticeFrom(params)}
      />
      <SpendGuardrails limits={limits} evaluation={evaluation} />
    </div>
  );
}
