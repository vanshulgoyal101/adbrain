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
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f8f4ef_100%)] p-5 shadow-[var(--shadow-soft)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
              Advertising workspace
            </p>
            <h1 className="font-display text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
              {business.name}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600 sm:text-base">
              {business.description ?? "Your local growth workspace for brand, ads, and launches."}
            </p>
          </div>
          <Link href="/create">
            <Button className="h-11 rounded-xl bg-slate-950 px-5 text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800">
              <Wand2 className="h-4 w-4" /> Create an ad
            </Button>
          </Link>
        </div>
      </div>

      {spend &&
        (spend.evaluation.status === "approaching" ||
          spend.evaluation.status === "over") && (
          <div>
            <SpendStatusBanner evaluation={spend.evaluation} />
          </div>
        )}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Brand foundation", value: "Ready", href: "/brand", tone: "text-blue-700" },
          { label: "Ads to review", value: String(drafts), href: "/studio", tone: drafts ? "text-amber-700" : "text-slate-500" },
          { label: "Meta connection", value: metaConnection?.ready ? "Connected" : "Needs setup", href: "/settings", tone: metaConnection?.ready ? "text-emerald-700" : "text-amber-700" },
          { label: "Active campaigns", value: String(campaigns.filter((c) => c.status === "active").length), href: "/campaigns", tone: "text-slate-700" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_8px_20px_rgba(15,23,42,0.03)] transition-transform hover:-translate-y-0.5"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
            <p className={cn("mt-3 text-xl font-semibold", item.tone)}>{item.value}</p>
          </Link>
        ))}
      </div>

      <Link href="/create" className="block">
        <div className="flex items-center justify-between gap-4 rounded-[26px] border border-slate-200 bg-[linear-gradient(120deg,#1f2a3d_0%,#273b5c_44%,#364d74_100%)] p-5 text-white shadow-[0_18px_38px_rgba(15,23,42,0.14)] transition-transform hover:-translate-y-0.5 sm:p-6">
          <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15">
              <Wand2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold">Create campaign-ready ads</p>
              <p className="text-sm text-slate-200">
                Describe the offer, audience, and goal — then review on-brand concepts before launch.
              </p>
            </div>
          </div>
          <ArrowRight className="hidden h-5 w-5 flex-none text-slate-200 sm:block" />
        </div>
      </Link>

      {!progress.complete && nextStep && (
        <Card className="overflow-hidden border-slate-200 bg-white/80 shadow-[var(--shadow-soft)]">
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Circle className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                    Next best action
                  </p>
                  <span className="text-xs text-slate-400">
                    {progress.done} of {progress.total} complete
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  {nextStep.title}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-slate-600">
                  {nextStep.hint}
                </p>
              </div>
            </div>
            <Link href={nextStep.href} className="flex-none">
              <Button size="sm" className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
          <div className="h-1.5 bg-slate-100">
            <div
              className="h-full bg-slate-950 transition-[width]"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Campaign flow</h2>
          </div>
          <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4 shadow-[var(--shadow-soft)]">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { title: "Brand", detail: "Voice, offer, audience", state: "Ready" },
                { title: "Creative", detail: "Review approved ads", state: drafts ? `${drafts} to review` : "Ready" },
                { title: "Launch", detail: "Pause, review, activate", state: campaigns.length ? `${campaigns.length} tracked` : "No campaigns" },
              ].map((step, index) => (
                <div key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Step {index + 1}</span>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-600">{step.state}</span>
                  </div>
                  <p className="font-semibold text-slate-900">{step.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
          </div>
          <div className="space-y-3">
            <Link href="/brand" className="block rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-[0_8px_20px_rgba(15,23,42,0.03)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">Edit Brand Brain</p>
                  <p className="text-sm text-slate-600">Tune offer, voice, and service areas</p>
                </div>
                <Building2 className="h-4 w-4 text-slate-500" />
              </div>
            </Link>
            <Link href="/studio" className="block rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-[0_8px_20px_rgba(15,23,42,0.03)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">Open Creative Studio</p>
                  <p className="text-sm text-slate-600">Approve variants and export the winning ad</p>
                </div>
                <Sparkles className="h-4 w-4 text-slate-500" />
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/brand">
          <Button variant="outline" className="rounded-xl border-slate-300 bg-white/80">
            <Building2 className="h-4 w-4" /> Edit Brand Brain
          </Button>
        </Link>
        <Link href="/studio">
          <Button variant="outline" className="rounded-xl border-slate-300 bg-white/80">
            <Sparkles className="h-4 w-4" /> Open Creative Studio
          </Button>
        </Link>
      </div>

      {creatives.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Recent creatives
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {creatives.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
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
        <div>
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
