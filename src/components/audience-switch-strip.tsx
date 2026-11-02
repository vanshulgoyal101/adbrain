"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { campaignsTranslator, type Words } from "@/i18n/words";

/**
 * #765 (b): a running campaign's new audience waits as a paused copy. The owner turns it on (the current audience
 * stops at the same moment, never both) or cancels it (only the copy goes; the current audience keeps running).
 */
export function AudienceSwitchStrip({ campaignId, operationId, running, lastError = null, onDone, words }: {
  campaignId: string;
  operationId: string;
  running: boolean;
  /** The last try's failure, kept on the edit row, so a stuck switch shows after a reload with its retry. */
  lastError?: string | null;
  onDone: (message: string) => void;
  /** The owner's `campaigns` words (#1438); English without them. */
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  const labelId = React.useId();
  const [busy, setBusy] = React.useState<"switch" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(lastError ? t("audienceSwitch.lastTry", { error: lastError }) : null);

  const act = async (action: "switch" | "cancel") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/audience/switch`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, action }),
      });
      const data = await res.json().catch(() => ({})) as { error?: unknown };
      if (!res.ok) { setError(typeof data.error === "string" ? data.error : t("audienceSwitch.failed")); return; }
      onDone(action === "switch"
        ? running
          ? t("audienceSwitch.switchedRunning")
          : t("audienceSwitch.switchedPaused")
        : t("audienceSwitch.cancelled"));
    } catch {
      setError(t("audienceSwitch.offline"));
    } finally {
      setBusy(null);
    }
  };

  // #1737: a choice waiting for the owner, not a warning: a neutral inset, one solid action, Cancel as quiet text.
  // #1274: the row layout follows the strip's own width (cards can be half-width on a wide screen).
  return (
    <div role="group" aria-labelledby={labelId} className="@container rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="min-w-0 text-sm text-slate-700">
          <p id={labelId} className="font-medium text-slate-950">{t("audienceSwitch.title")}</p>
          <p>
            {running
              ? t("audienceSwitch.running")
              : t("audienceSwitch.paused")}
          </p>
          {error && <p role="alert" className="mt-1 font-medium text-red-800">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-1 @2xl:flex-row @2xl:items-center">
          <Button variant="quiet" className="h-11" onClick={() => void act("cancel")} disabled={!!busy}>
            {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("audienceSwitch.cancel")}
          </Button>
          <Button className="h-11" onClick={() => void act("switch")} disabled={!!busy}>
            {busy === "switch" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {running ? t("audienceSwitch.turnOn") : t("audienceSwitch.use")}
          </Button>
        </div>
      </div>
    </div>
  );
}
