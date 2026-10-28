import Link from "next/link";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { Studio } from "@/components/studio";
import { DemoLlmUsage } from "@/components/demo-llm-usage";
import { Card, CardContent } from "@/components/ui/card";
import { getCreatives, getPrimaryBusiness } from "@/lib/supabase/queries";
import { getUser } from "@/lib/supabase/queries";
import { isProspectSession } from "@/lib/prospect-session";
import { businessLLMUsageSummary } from "@/lib/llm/persist";
import { privacyOperatorAllowed } from "@/lib/privacy-requests";
import { clientCreative } from "@/lib/creative/client-receipt";

export const metadata = { title: "Review ads" };

async function StudioUsage({ usage }: { usage: Promise<Awaited<ReturnType<typeof businessLLMUsageSummary>> | null> }) {
  const summary = await usage;
  return summary ? <DemoLlmUsage usage={summary} /> : null;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; creative?: string }>;
}) {
  const [business, user] = await Promise.all([getPrimaryBusiness(), getUser()]);

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Review ads</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your business first: AdBrain uses it to write
              on-brand ads.
            </p>
            <Link
              href="/brand"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white"
            >
              Set up your business
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // #403: cost, tokens and model names are operator information, not owner information.
  // Checked alongside the creatives; the usage report starts as soon as it's known and streams in.
  const operatorCheck = user ? privacyOperatorAllowed().catch(() => false) : Promise.resolve(false);
  const usageReport = operatorCheck.then((allowed) => (allowed ? businessLLMUsageSummary(business.id) : null));
  const [creatives, params, operator] = await Promise.all([
    getCreatives(business.id),
    searchParams,
    operatorCheck,
  ]);
  const usage = operator ? usageReport : null;
  const filter = params.creative
    ? "all"
    : params.status === "draft" || params.status === "approved"
      ? params.status
      : "all";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-950">Review</h1>
      <div className="mt-4">
        <Studio
          key={`${business.id}:${filter}:${params.creative ?? ""}`}
          business={business}
          initialCreatives={creatives.map(clientCreative)}
          initialFilter={filter}
          initialCreativeId={params.creative ?? null}
          showInternals={operator}
          sample={await isProspectSession()}
        />
        {usage && <Suspense fallback={null}><StudioUsage usage={usage} /></Suspense>}
      </div>
    </div>
  );
}
