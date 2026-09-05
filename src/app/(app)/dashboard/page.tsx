import Link from "next/link";
import { ArrowRight, Building2, Circle, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SpendStatusBanner } from "@/components/spend-status";
import { getMetaConnection } from "@/lib/meta/credentials";
import {
  getCampaigns,
  getCreatives,
  getAuditLog,
  getPrimaryBusiness,
  getSpendEvaluation,
} from "@/lib/supabase/queries";
import { onboardingProgress, onboardingSteps } from "@/lib/onboarding";
import { describeAuditEvent } from "@/lib/audit-labels";
import { cn, formatDateShort } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const business = await getPrimaryBusiness();
  const creatives = business ? await getCreatives(business.id) : [];
  const audit = business ? await getAuditLog(business.id, 8) : [];
  const campaigns = business ? await getCampaigns(business.id) : [];
  const spend = business ? await getSpendEvaluation(business.id) : null;
  const metaConnection = business ? await getMetaConnection(business.id) : null;
  const drafts = creatives.filter((c) => c.status === "draft").length;
  const approved = creatives.filter((c) => c.status === "approved").length;

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome to AdBrain</h1>
        <p className="mt-1 text-slate-600">
          Let’s set up your Brand Brain — it powers every creative you generate.
        </p>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Create your Brand Brain
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-600">
                Add your business details, voice, and offers — or autofill them
                from your website in one click.
              </p>
            </div>
            <Link href="/brand">
              <Button>
                Set up Brand Brain <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const steps = onboardingSteps({
    hasBrand: true,
    creativeCount: creatives.length,
    approvedCount: approved,
    campaignCount: campaigns.length,
  });
  const progress = onboardingProgress(steps);
  const nextStep = progress.next;

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
            Your advertising workspace
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] text-slate-950">
            {business.name}
          </h1>
          <p className="mt-1 text-slate-600">
            {business.description ?? "Your business dashboard."}
          </p>
        </div>
        <Link href="/create">
          <Button>
            <Wand2 className="h-4 w-4" /> Create an ad
          </Button>
        </Link>
      </div>

      {spend &&
        (spend.evaluation.status === "approaching" ||
          spend.evaluation.status === "over") && (
          <div className="mt-6">
            <SpendStatusBanner evaluation={spend.evaluation} />
          </div>
        )}

      <Link href="/create" className="mt-6 block">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-[linear-gradient(110deg,#eef4ff,#f8fbff)] p-5 shadow-[0_8px_24px_rgba(21,94,239,0.07)] transition-colors hover:border-blue-300 hover:bg-blue-50">
          <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-600 text-white">
              <Wand2 className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-slate-900">Make an ad in a few taps</p>
              <p className="text-sm text-slate-600">
                Just tell the Ad Assistant what you want — it asks a couple of easy
                questions and hands you a finished ad.
              </p>
            </div>
          </div>
          <ArrowRight className="hidden h-5 w-5 flex-none text-blue-700 sm:block" />
        </div>
      </Link>

      <div className="mt-6 grid gap-2 border-y border-slate-200/80 py-3 sm:grid-cols-4 sm:gap-0">
        {[
          { label: "Brand foundation", value: "Ready", href: "/brand", tone: "text-blue-700" },
          { label: "Ads to review", value: String(drafts), href: "/studio", tone: drafts ? "text-amber-700" : "text-slate-500" },
          { label: "Meta connection", value: metaConnection?.ready ? "Connected" : "Needs setup", href: "/settings", tone: metaConnection?.ready ? "text-blue-700" : "text-amber-700" },
          { label: "Active campaigns", value: String(campaigns.filter((c) => c.status === "active").length), href: "/campaigns", tone: "text-slate-700" },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 sm:border-r sm:border-slate-200/80 sm:last:border-r-0">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className={cn("mt-1 text-sm font-semibold", item.tone)}>{item.value}</p>
          </Link>
        ))}
      </div>

      {!progress.complete && nextStep && (
        <Card className="mt-6 overflow-hidden border-blue-200">
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Circle className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
                    Next best action
                  </p>
                  <span className="text-xs text-slate-400">
                    {progress.done} of {progress.total} complete
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">
                  {nextStep.title}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-slate-600">
                  {nextStep.hint}
                </p>
              </div>
            </div>
            <Link href={nextStep.href} className="flex-none">
              <Button size="sm">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
          <div className="h-1 bg-slate-100">
            <div
              className="h-full bg-blue-600 transition-[width]"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </Card>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/brand">
          <Button variant="outline">
            <Building2 className="h-4 w-4" /> Edit Brand Brain
          </Button>
        </Link>
        <Link href="/studio">
          <Button variant="outline">
            <Sparkles className="h-4 w-4" /> Open Creative Studio
          </Button>
        </Link>
      </div>

      {creatives.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Recent creatives
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {creatives.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                <div className="aspect-square">
                  {c.image_url && (
                    <img
                      src={c.image_url}
                      alt={c.headline ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audit.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Recent activity
          </h2>
          <Card>
            <CardContent className="flex flex-col divide-y divide-slate-100 p-0">
              {audit.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="truncate text-slate-700">
                    {describeAuditEvent(e.action, e.reason)}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatDateShort(e.created_at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
