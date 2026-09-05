import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Circle, ImageIcon, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SpendStatusBanner } from "@/components/spend-status";
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

  const stats = [
    { label: "Total creatives", value: creatives.length, icon: ImageIcon },
    { label: "Drafts", value: drafts, icon: Sparkles },
    { label: "Approved", value: approved, icon: CheckCircle2 },
  ];

  const steps = onboardingSteps({
    hasBrand: true,
    creativeCount: creatives.length,
    approvedCount: approved,
    campaignCount: campaigns.length,
  });
  const progress = onboardingProgress(steps);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
          <p className="mt-1 text-slate-600">
            {business.description ?? "Your business dashboard."}
          </p>
        </div>
        <Link href="/studio">
          <Button>
            <Sparkles className="h-4 w-4" /> New creatives
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
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 transition-colors hover:bg-blue-100">
          <div className="flex items-center gap-4">
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
          <ArrowRight className="h-5 w-5 flex-none text-blue-700" />
        </div>
      </Link>

      {!progress.complete && (
        <Card className="mt-6">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Get set up</h2>
              <span className="text-sm text-slate-500">
                {progress.done} of {progress.total} done
              </span>
            </div>
            <ol className="flex flex-col gap-2">
              {steps.map((step) => (
                <li key={step.id}>
                  <Link
                    href={step.href}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                      step.done
                        ? "border-slate-100 bg-slate-50"
                        : progress.next?.id === step.id
                          ? "border-blue-300 bg-blue-50 hover:bg-blue-100"
                          : "border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    {step.done ? (
                      <CheckCircle2 className="h-5 w-5 flex-none text-blue-600" />
                    ) : (
                      <Circle className="h-5 w-5 flex-none text-slate-300" />
                    )}
                    <div>
                      <p
                        className={cn(
                          "text-sm font-medium",
                          step.done ? "text-slate-400 line-through" : "text-slate-900",
                        )}
                      >
                        {step.title}
                      </p>
                      {!step.done && (
                        <p className="text-sm text-slate-500">{step.hint}</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-sm text-slate-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
