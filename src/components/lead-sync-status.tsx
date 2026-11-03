"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { enquiryAge, type enquiriesTranslator } from "@/i18n/words";

/** #1260: checking runs on open; the time sits quietly here, with a small Check now for impatient owners and retries. */
export function LeadSyncStatus({ t, syncing, lastSync, now, keepChecking, onCheck }: {
  t: ReturnType<typeof enquiriesTranslator>;
  syncing: boolean;
  lastSync: number;
  now: Date;
  keepChecking: boolean;
  onCheck: () => void;
}) {
  const updated = lastSync ? t("sync.updated", { age: enquiryAge(t, new Date(lastSync).toISOString(), now) }) : null;
  return (
    <p className="-mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      {/* #2748: both texts share one grid cell, so the wider one holds the width and Check now doesn't slide as they swap. */}
      <span className="inline-grid">
        <span className="[grid-area:1/1]" aria-live="polite">{syncing ? t("sync.checking") : updated}</span>
        <span className="invisible [grid-area:1/1]" aria-hidden="true">{syncing ? updated : t("sync.checking")}</span>
      </span>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 font-medium text-blue-700 disabled:text-slate-400" onClick={onCheck} disabled={syncing}>
        {syncing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
        {t(keepChecking ? "sync.keepChecking" : "sync.checkNow")}
      </button>
    </p>
  );
}
