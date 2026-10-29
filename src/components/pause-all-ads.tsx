"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { translator, type AppLocale } from "@/i18n/locale";
import { adsManagerUrl } from "@/lib/meta/ads-manager-url";
import type { Campaign } from "@/lib/types";

type LiveCampaign = Pick<Campaign, "id" | "name" | "meta_ad_account_id" | "meta_campaign_id">;
type RowState = "waiting" | "pausing" | "paused" | "failed";
type Run = { list: LiveCampaign[]; state: Record<string, RowState> };

/**
 * #1968 (CPO, #1956): one confirm, then each live campaign's existing emergency stop (`PATCH status: paused`:
 * campaign, ad sets, ads, read back), one at a time. "All paused" only when every one was confirmed. No Resume all.
 * The run is kept in state from the confirm: after `router.refresh()` the paused campaigns leave `campaigns`,
 * and the result must still say what happened to every one of them (#2011).
 */
export function PauseAllAds({ campaigns, locale = "en" }: { campaigns: LiveCampaign[]; locale?: AppLocale }) {
  const t = translator(locale, "pauseAll");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [run, setRun] = useState<Run | null>(null);
  const [progress, setProgress] = useState<{ k: number; n: number } | null>(null);
  if (!campaigns.length && !run) return null;

  const total = run ? run.list.length : campaigns.length;
  const failed = run ? run.list.filter((campaign) => run.state[campaign.id] === "failed") : [];
  const busy = progress !== null;

  async function pause(list: LiveCampaign[], base: Run) {
    let state = { ...base.state, ...Object.fromEntries(list.map((campaign) => [campaign.id, "waiting" as RowState])) };
    const mark = (id: string, value: RowState) => {
      state = { ...state, [id]: value };
      setRun({ list: base.list, state });
    };
    setRun({ list: base.list, state });
    for (const [index, campaign] of list.entries()) {
      setProgress({ k: index + 1, n: list.length });
      mark(campaign.id, "pausing");
      const ok = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }).then((response) => response.ok, () => false);
      mark(campaign.id, ok ? "paused" : "failed");
    }
    setProgress(null);
    router.refresh();
  }

  async function start() {
    if (!(await confirm({ title: t("title"), description: t("body", { n: total }), confirmLabel: t("confirm"), cancelLabel: t("cancel") }))) return;
    const list = [...campaigns];
    await pause(list, { list, state: {} });
  }

  const rowLabel: Record<RowState, string> = { waiting: t("row.waiting"), pausing: t("row.pausing"), paused: t("row.paused"), failed: t("row.failed") };
  const names = failed.map((campaign) => `'${campaign.name || campaign.id}'`).join(", ");
  const done = run !== null && !busy && failed.length === 0;
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      {confirmDialog}
      {run && (
        <ul aria-label={t("button")} className="w-full space-y-1 text-sm">
          {run.list.map((campaign) => {
            const state = run.state[campaign.id] ?? "waiting";
            return (
              <li key={campaign.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-slate-900">{campaign.name || campaign.id}</span>
                <span className={state === "paused" ? "shrink-0 text-blue-700" : state === "failed" ? "shrink-0 font-medium text-warning" : "shrink-0 text-slate-600"}>
                  {rowLabel[state]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {done ? (
        <p role="status" className="flex w-full items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("done", { n: total })}
        </p>
      ) : null}
      {!busy && failed.length ? (
        <p role="alert" className="flex w-full items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("partial", { k: total - failed.length, n: total, f: failed.length, names })}
        </p>
      ) : null}
      {!done && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => (run && failed.length ? pause(failed, run) : start())}>
            {progress ? t("pausing", progress) : failed.length ? t("tryAgain") : t("button")}
          </Button>
          {!busy && failed.length ? (
            <a href={adsManagerUrl(failed[0])} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {t("openAdsManager")}<ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
