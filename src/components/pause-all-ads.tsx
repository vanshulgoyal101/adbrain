"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { translator, type AppLocale } from "@/i18n/locale";
import { adsManagerUrl } from "@/lib/meta/ads-manager-url";
import type { Campaign } from "@/lib/types";

type LiveCampaign = Pick<Campaign, "id" | "name" | "meta_ad_account_id" | "meta_campaign_id">;

/**
 * #1968 (CPO, #1956): one confirm, then each live campaign's existing emergency stop (`PATCH status: paused`:
 * campaign, ad sets, ads, read back), one at a time. "All paused" only when every one was confirmed. No Resume all.
 */
export function PauseAllAds({ campaigns, locale = "en" }: { campaigns: LiveCampaign[]; locale?: AppLocale }) {
  const t = translator(locale, "pauseAll");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<LiveCampaign[] | null>(null);
  if (!campaigns.length) return null;
  const total = campaigns.length;

  async function pause(list: LiveCampaign[]) {
    setBusy(true);
    const stillRunning: LiveCampaign[] = [];
    for (const campaign of list) {
      const ok = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }).then((response) => response.ok, () => false);
      if (!ok) stillRunning.push(campaign);
    }
    setFailed(stillRunning);
    setBusy(false);
    router.refresh();
  }

  async function start() {
    if (!(await confirm({ title: t("title"), description: t("body", { n: total }), confirmLabel: t("confirm"), cancelLabel: t("cancel") }))) return;
    await pause(campaigns);
  }

  const names = (failed ?? []).map((campaign) => `'${campaign.name || campaign.id}'`).join(", ");
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      {confirmDialog}
      {failed === null || failed.length ? (
        <Button type="button" size="sm" variant="outline" className="max-sm:h-11" disabled={busy}
          onClick={() => (failed?.length ? pause(failed) : start())}>
          {busy ? t("pausing") : failed?.length ? t("tryAgain") : t("button")}
        </Button>
      ) : null}
      <p aria-live="polite" className="text-sm text-slate-700">
        {failed === null || busy ? null : failed.length === 0
          ? t("done", { n: total })
          : t("partial", { k: total - failed.length, n: total, names })}
      </p>
      {!busy && failed?.length ? (
        <a href={adsManagerUrl(failed[0])} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-700 underline">
          {t("openAdsManager")}<ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
