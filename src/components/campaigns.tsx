"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import {
  TargetingControls,
  defaultTargeting,
  type TargetingValue,
} from "@/components/targeting-controls";
import { CampaignChat } from "@/components/campaign-chat";
import type { LeadForm } from "@/lib/meta/client";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";
import { BUDGET_PRESETS, describeBudget } from "@/lib/campaign/budget";
import { cn, formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  paused: "bg-amber-50 text-amber-700",
  active: "bg-blue-50 text-blue-700",
  draft: "bg-slate-100 text-slate-600",
  completed: "bg-slate-100 text-slate-600",
};

export function Campaigns({
  business,
  approved,
  initialCampaigns,
  initialResults,
  leadForms,
  leadFormError,
  metaReady,
  adAccountId,
}: {
  business: Business;
  approved: Creative[];
  initialCampaigns: Campaign[];
  initialResults: Record<string, CampaignResult>;
  leadForms: LeadForm[];
  leadFormError: string | null;
  metaReady: boolean;
  adAccountId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState(200);
  const [leadFormId, setLeadFormId] = useState(leadForms[0]?.id ?? "");
  const [name, setName] = useState(`${business.name} — leads`);
  const [targeting, setTargeting] = useState<TargetingValue>(defaultTargeting);
  const [abTest, setAbTest] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [results, setResults] =
    useState<Record<string, CampaignResult>>(initialResults);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  async function syncFromMeta(opts: { silent?: boolean } = {}) {
    setSyncing(true);
    if (!opts.silent) setError(null);
    try {
      const res = await fetch("/api/campaigns/sync", { method: "POST" });
      const data = (await res.json()) as {
        campaigns?: Campaign[];
        error?: string;
      };
      if (res.ok && Array.isArray(data.campaigns)) {
        setCampaigns(data.campaigns);
        setLastSynced(new Date());
      } else if (!res.ok && !opts.silent) {
        setError(data.error ?? "Sync failed.");
      }
    } catch {
      if (!opts.silent) setError("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync from Meta once when the page opens, so campaigns stay fresh.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (metaReady && !autoSynced.current) {
      autoSynced.current = true;
      void syncFromMeta({ silent: true });
    }
  }, [metaReady]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createCampaign() {
    setError(null);
    setNotice(null);
    if (selected.size === 0) {
      setError("Select at least one creative.");
      return;
    }
    if (!leadFormId) {
      setError("Choose a lead form.");
      return;
    }
    if (budget <= 0) {
      setError("Enter a daily budget.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          creativeIds: [...selected],
          dailyBudget: budget,
          leadFormId,
          name,
          targeting: {
            location: {
              mode: targeting.locationMode,
              included: targeting.included,
              excluded: targeting.excluded,
              radiusKm: targeting.radiusKm,
            },
            age: {
              mode: targeting.ageMode,
              min: targeting.ageMin,
              max: targeting.ageMax,
            },
          },
          abTest,
        }),
      });
      const data = (await res.json()) as {
        campaign?: Campaign;
        audience?: string;
        error?: string;
      };
      if (!res.ok || !data.campaign) {
        setError(data.error ?? "Could not create campaign.");
        return;
      }
      setCampaigns((prev) => [data.campaign as Campaign, ...prev]);
      setSelected(new Set());
      setNotice(
        `Campaign created — it's PAUSED. ${
          data.audience ? `Targeting: ${data.audience} ` : ""
        }Review and activate it in Meta Ads Manager when you're ready to spend.`,
      );
    } catch {
      setError("Could not create campaign.");
    } finally {
      setCreating(false);
    }
  }

  async function refresh(id: string) {
    setRefreshingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/refresh`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        result?: CampaignResult;
        summary?: string;
        error?: string;
      };
      if (res.ok) {
        if (data.result) setResults((p) => ({ ...p, [id]: data.result! }));
        if (data.summary) setSummaries((p) => ({ ...p, [id]: data.summary! }));
      } else {
        setError(data.error ?? "Couldn't refresh results.");
      }
    } catch {
      setError("Couldn't refresh results — check your connection.");
    } finally {
      setRefreshingId(null);
    }
  }

  function adsLink(metaId: string) {
    const acct = adAccountId.replace("act_", "");
    return `https://www.facebook.com/adsmanager/manage/campaigns?act=${acct}&selected_campaign_ids=${metaId}`;
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);

  async function setCampaignStatus(c: Campaign, next: "active" | "paused") {
    setStatusChangingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setCampaigns((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, status: next } : x)),
        );
        setNotice(next === "active" ? "Campaign resumed." : "Campaign paused.");
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Couldn't update the campaign.");
      }
    } catch {
      setError("Couldn't update the campaign — check your connection.");
    } finally {
      setStatusChangingId(null);
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (
      !window.confirm(
        `Delete "${c.name ?? "this campaign"}"? This removes it from Meta and can't be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Couldn't delete the campaign.");
      }
    } catch {
      setError("Couldn't delete the campaign — check your connection.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!metaReady && (
        <Alert variant="warning">
          Meta isn’t configured. Add <code>META_SYSTEM_USER_TOKEN</code>,{" "}
          <code>META_AD_ACCOUNT_ID</code>, and <code>META_PAGE_ID</code> to your
          environment to launch campaigns.
        </Alert>
      )}

      {metaReady && (
        <CampaignChat
          onCreated={(c) => setCampaigns((prev) => [c, ...prev])}
        />
      )}

      {metaReady && (
        <Card>
          <CardHeader>
            <CardTitle>New campaign</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {approved.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-sm text-slate-500">
                  You need at least one approved creative before you can launch.
                  Head to the Creative Studio, generate a few ads, and approve
                  the ones you like.
                </p>
                <Link href="/studio">
                  <Button variant="outline" size="sm">
                    <Sparkles className="h-4 w-4" /> Go to Creative Studio
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <Label>Choose creatives</Label>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {approved.map((c) => {
                      const isSel = selected.has(c.id);
                      return (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => toggle(c.id)}
                          className={cn(
                            "overflow-hidden rounded-lg border-2 text-left transition-colors",
                            isSel
                              ? "border-blue-500"
                              : "border-transparent hover:border-slate-200",
                          )}
                        >
                          <div className="aspect-square bg-slate-100">
                            {c.image_url && (
                              <img
                                src={c.image_url}
                                alt={c.headline || "Ad creative preview"}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            )}
                          </div>
                          <p className="truncate px-2 py-1.5 text-xs font-medium text-slate-700">
                            {c.headline}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="name">Campaign name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="budget">Daily budget (₹)</Label>
                    <Input
                      id="budget"
                      type="number"
                      min={50}
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="leadform">Lead form</Label>
                    <select
                      id="leadform"
                      value={leadFormId}
                      onChange={(e) => setLeadFormId(e.target.value)}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    >
                      {leadForms.length === 0 && (
                        <option value="">No lead forms found</option>
                      )}
                      {leadForms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="-mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Quick pick:</span>
                  {BUDGET_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setBudget(amount)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        budget === amount
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      ₹{amount}/day
                    </button>
                  ))}
                  <span className="ml-auto text-xs font-medium text-blue-700">
                    {describeBudget(budget)}
                  </span>
                </div>

                {leadFormError && (
                  <Alert variant="warning">
                    Couldn’t load lead forms: {leadFormError}
                  </Alert>
                )}

                <div className="flex flex-col gap-2">
                  <Label>Audience &amp; location</Label>
                  <TargetingControls
                    value={targeting}
                    onChange={setTargeting}
                    brandAreas={business.locations ?? []}
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={abTest}
                    onChange={(e) => setAbTest(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-slate-800">
                      A/B test the audience by age
                    </span>
                    <span className="block text-xs text-slate-500">
                      Advanced: splits your age range into two ad sets so Meta can
                      find the cheaper audience for you.
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={createCampaign} disabled={creating}>
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                    Create paused campaign
                  </Button>
                  <span className="text-xs text-slate-400">
                    Created paused — no spend until you activate it in Meta.
                  </span>
                </div>
                <HowItWorks />
                {error && <Alert variant="error">{error}</Alert>}
                {notice && <Alert variant="success">{notice}</Alert>}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Your campaigns{" "}
            <span className="font-normal text-slate-400">
              ({campaigns.length})
            </span>
          </h2>
          {metaReady && (
            <div className="flex items-center gap-2">
              {lastSynced && !syncing && (
                <span className="text-xs text-slate-400">
                  Synced {timeAgo(lastSynced)}
                </span>
              )}
              {campaigns.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/api/campaigns/report";
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400"
                >
                  <FileText className="h-4 w-4" /> Export report
                </button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncFromMeta()}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {syncing ? "Syncing…" : "Sync from Meta"}
              </Button>
            </div>
          )}
        </div>
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-10 text-center">
              <Rocket className="h-6 w-6 text-slate-300" />
              <p className="font-medium text-slate-600">No campaigns yet</p>
              <p className="max-w-sm text-sm text-slate-400">
                Launch your first one above — with AI, or by picking creatives
                and a budget. It’s created paused, so nothing spends until you
                say so.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {campaigns.map((c) => {
              const r = results[c.id];
              return (
                <Card key={c.id}>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">
                          {c.name ?? `${business.name} — ${c.objective}`}
                        </h3>
                        <Badge
                          className={
                            STATUS_STYLES[c.status] ??
                            "bg-slate-100 text-slate-600"
                          }
                        >
                          {c.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-500">
                          {c.daily_budget != null
                            ? `${formatCurrency(c.daily_budget)}/day`
                            : c.objective}
                        </span>
                        {c.meta_campaign_id && (
                          <a
                            href={adsLink(c.meta_campaign_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                          >
                            Ads Manager <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => refresh(c.id)}
                          disabled={refreshingId === c.id}
                        >
                          {refreshingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Refresh results
                        </Button>
                        {c.meta_campaign_id &&
                          (c.status === "active" || c.status === "paused") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setCampaignStatus(
                                  c,
                                  c.status === "active" ? "paused" : "active",
                                )
                              }
                              disabled={statusChangingId === c.id}
                            >
                              {statusChangingId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : c.status === "active" ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                              {c.status === "active" ? "Pause" : "Resume"}
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteCampaign(c)}
                          disabled={deletingId === c.id}
                          aria-label="Delete campaign"
                        >
                          {deletingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-slate-400" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {r && (
                      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
                        <Stat label="Impressions" value={formatNumber(r.impressions)} />
                        <Stat label="Clicks" value={formatNumber(r.clicks)} />
                        <Stat label="Leads" value={formatNumber(r.leads)} />
                        <Stat
                          label="Cost / lead"
                          value={r.cpl != null ? formatCurrency(r.cpl) : "—"}
                        />
                      </div>
                    )}
                    {summaries[c.id] && (
                      <p className="text-sm text-slate-600">{summaries[c.id]}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  "We create the campaign paused — nothing spends yet.",
  "Open it in Meta Ads Manager to review the ads and audience.",
  "Flip it on when you're happy; leads start coming in.",
  "Come back and hit “Refresh results” to see leads and cost per lead in plain English.",
];

function HowItWorks() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        What happens next
      </p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-600">
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
