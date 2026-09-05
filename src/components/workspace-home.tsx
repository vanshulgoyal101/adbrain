import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ImageIcon,
  Plus,
} from "lucide-react";
import { SpendStatusBanner } from "@/components/spend-status";
import { buildWorkQueue, missingBrandContext } from "@/lib/work-queue";
import { describeAuditEvent } from "@/lib/audit-labels";
import { formatDateShort } from "@/lib/utils";
import type { SpendEvaluation } from "@/lib/campaign/spend";
import type { AuditLog, Business, Campaign, Creative } from "@/lib/types";

export interface WorkspaceHomeProps {
  business: Business | null;
  creatives: Creative[];
  campaigns: Campaign[];
  audit: AuditLog[];
  metaReady: boolean;
  spend: SpendEvaluation | null;
}

const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800";

export function WorkspaceHome({
  business,
  creatives,
  campaigns,
  audit,
  metaReady,
  spend,
}: WorkspaceHomeProps) {
  const queue = buildWorkQueue({ business, creatives, campaigns, metaReady });
  const drafts = creatives.filter(
    (creative) => creative.status === "draft",
  ).length;
  const approved = creatives.filter(
    (creative) => creative.status === "approved",
  ).length;
  const active = campaigns.filter(
    (campaign) => campaign.status === "active",
  ).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Home / {business ? "Advertising workspace" : "New workspace"}
          </p>
          <h1 className="mt-2 break-words text-3xl font-semibold text-slate-950">
            {business?.name ?? "Welcome to AdBrain"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {business
              ? `${business.vertical || "Local business"}${business.locations.length ? ` / ${business.locations.join(", ")}` : ""}`
              : "Start with the business behind your ads."}
          </p>
        </div>
        <Link href={business ? "/create" : "/brand"} className={actionClass}>
          {business ? (
            <Plus size={17} aria-hidden="true" />
          ) : (
            <Building2 size={17} aria-hidden="true" />
          )}
          {business ? "Create an ad" : "Set up Brand Brain"}
        </Link>
      </header>

      {spend && (spend.status === "approaching" || spend.status === "over") && (
        <SpendStatusBanner evaluation={spend} />
      )}

      {business && (
        <dl className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 pb-6 lg:grid-cols-4">
          {[
            {
              label: "Awaiting review",
              value: drafts,
              href: "/studio?status=draft",
            },
            {
              label: "Approved ads",
              value: approved,
              href: "/studio?status=approved",
            },
            { label: "Active campaigns", value: active, href: "/campaigns" },
            {
              label: "Meta connection",
              value: metaReady ? "Connected" : "Needs setup",
              href: "/settings",
            },
          ].map((metric) => (
            <div key={metric.label} className="min-w-0 px-4 py-3 first:pl-0">
              <dt className="text-xs text-slate-500">{metric.label}</dt>
              <dd className="mt-2">
                <Link
                  href={metric.href}
                  className="break-words text-xl font-semibold text-slate-900 hover:text-blue-700"
                >
                  {metric.value}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="work-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="work-title" className="text-lg font-semibold text-slate-900">
            Next up
          </h2>
          <span className="text-xs text-slate-500">
            {queue.length} {queue.length === 1 ? "action" : "actions"}
          </span>
        </div>
        {queue.length ? (
          <ol className="divide-y divide-slate-200 border-y border-slate-200">
            {queue.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-4 py-5"
              >
                <span
                  aria-hidden="true"
                  className={`text-xs font-semibold ${item.tone === "attention" ? "text-amber-700" : "text-slate-400"}`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                    {item.detail}
                  </p>
                </div>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                >
                  {item.action}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex items-start gap-3 border-y border-slate-200 py-6">
            <CheckCircle2
              size={20}
              className="shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            <div>
              <h3 className="font-medium text-slate-900">
                No pending review tasks
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Check your campaigns and results for the latest performance.
              </p>
              <Link
                href="/leads"
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700"
              >
                Open results <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        )}
      </section>

      {business && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(240px,1fr)]">
          <section aria-labelledby="campaigns-title" className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="campaigns-title"
                className="text-lg font-semibold text-slate-900"
              >
                Campaigns
              </h2>
              <Link
                href="/campaigns"
                className="text-sm font-medium text-blue-700"
              >
                View all
              </Link>
            </div>
            {campaigns.length ? (
              <ul className="divide-y divide-slate-200 border-y border-slate-200">
                {campaigns.slice(0, 5).map((campaign) => (
                  <li
                    key={campaign.id}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <Link
                        href="/campaigns"
                        className="break-words text-sm font-semibold text-slate-900 hover:text-blue-700"
                      >
                        {campaign.name || "Untitled campaign"}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateShort(campaign.created_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${campaign.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
                    >
                      {campaign.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="border-y border-slate-200 py-8">
                <p className="text-sm font-medium text-slate-900">
                  No campaigns yet
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Approved ads can be exported or used in a new paused campaign.
                </p>
              </div>
            )}
          </section>
          <section aria-labelledby="context-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="context-title"
                className="text-lg font-semibold text-slate-900"
              >
                Brand context
              </h2>
              <Link href="/brand" className="text-sm font-medium text-blue-700">
                Edit brand
              </Link>
            </div>
            <dl className="divide-y divide-slate-200 border-y border-slate-200 text-sm">
              {[
                { label: "Voice", value: business.brand_voice },
                { label: "Audience", value: business.target_audience },
              ].map((field) => (
                <div key={field.label} className="py-3">
                  <dt className="text-xs text-slate-500">{field.label}</dt>
                  <dd className="mt-1 break-words text-slate-800">
                    {field.value?.trim() || "Not added"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              {missingBrandContext(business).length
                ? "Some brand context is missing."
                : "Description, voice, audience, and service areas saved."}
            </p>
          </section>
        </div>
      )}

      {creatives.length > 0 && (
        <section aria-labelledby="creatives-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2
              id="creatives-title"
              className="text-lg font-semibold text-slate-900"
            >
              Recent creative
            </h2>
            <Link href="/studio" className="text-sm font-medium text-blue-700">
              Review all
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {creatives.slice(0, 4).map((creative) => (
              <li key={creative.id} className="min-w-0">
                <Link
                  href={`/studio?creative=${encodeURIComponent(creative.id)}`}
                  className="group block"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {creative.image_url ? (
                      <img
                        src={creative.image_url}
                        alt={creative.headline || "Ad creative"}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <ImageIcon
                        className="text-slate-400"
                        aria-label="No image"
                      />
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900 group-hover:text-blue-700">
                    {creative.headline || "Untitled creative"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {creative.status === "approved"
                      ? "Approved"
                      : "Needs review"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {audit.length > 0 && (
        <section aria-labelledby="activity-title">
          <h2
            id="activity-title"
            className="mb-3 text-lg font-semibold text-slate-900"
          >
            Recent activity
          </h2>
          <ul className="divide-y divide-slate-200 border-t border-slate-200">
            {audit.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span className="text-slate-700">
                  {describeAuditEvent(event.action, event.reason)}
                </span>
                <time
                  dateTime={event.created_at}
                  className="text-xs text-slate-500"
                >
                  {formatDateShort(event.created_at)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
