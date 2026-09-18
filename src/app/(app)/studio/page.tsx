import Link from "next/link";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { Studio } from "@/components/studio";
import { DemoLlmUsage } from "@/components/demo-llm-usage";
import { Card, CardContent } from "@/components/ui/card";
import { getCreatives, getPrimaryBusiness } from "@/lib/supabase/queries";
import { getUser } from "@/lib/supabase/queries";
import { businessLLMUsageSummary } from "@/lib/llm/persist";
import { getEnv } from "@/lib/env";

export const metadata = { title: "Creative Studio" };

async function StudioUsage({ usage }: { usage: ReturnType<typeof businessLLMUsageSummary> }) {
  return <DemoLlmUsage usage={await usage} />;
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
        <h1 className="text-2xl font-bold text-slate-900">Creative Studio</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first — the studio uses it to write
              on-brand ads.
            </p>
            <Link
              href="/brand"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white"
            >
              Go to Brand Brain
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showDemoUsage =
    user?.email?.toLowerCase() === getEnv().DEMO_USER_EMAIL.toLowerCase();
  const usage = showDemoUsage ? businessLLMUsageSummary(business.id) : null;
  const [creatives, params] = await Promise.all([
    getCreatives(business.id),
    searchParams,
  ]);
  const filter = params.creative
    ? "all"
    : params.status === "draft" || params.status === "approved"
      ? params.status
      : "all";

  return (
    <div>
      <header className="border-b border-slate-200 pb-5">
        <p className="text-xs text-slate-500">
          {business.name} / Creative workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Review</h1>
      </header>
      <div className="mt-6">
        <Studio
          key={`${business.id}:${filter}:${params.creative ?? ""}`}
          business={business}
          initialCreatives={creatives}
          initialFilter={filter}
          initialCreativeId={params.creative ?? null}
        />
        {usage && <Suspense fallback={null}><StudioUsage usage={usage} /></Suspense>}
      </div>
    </div>
  );
}
