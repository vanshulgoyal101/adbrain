"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { SpendEvaluation, SpendLimits } from "@/lib/campaign/spend";
import { formatMoney } from "@/lib/format";
import { settingsTranslator, type Words } from "@/i18n/words";

export function SpendGuardrails({
  limits,
  evaluation,
  words,
}: {
  limits: SpendLimits;
  evaluation: SpendEvaluation;
  /** #1438: the owner's language; without it, English. */
  words?: Words<"settings">;
}) {
  const t = settingsTranslator(words);
  const router = useRouter();
  const [cap, setCap] = useState(
    limits.weeklyCapRupees != null ? String(limits.weeklyCapRupees) : "",
  );
  const [alertPct, setAlertPct] = useState(String(limits.alertPct));
  const [autoPause, setAutoPause] = useState(limits.autoPause);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    const weeklyCapRupees = cap.trim() === "" ? null : Number(cap);
    const threshold = Number(alertPct);
    if (weeklyCapRupees !== null && (!Number.isInteger(weeklyCapRupees) || weeklyCapRupees <= 0 || weeklyCapRupees > 2_147_483_647)) {
      setError(t("spend.capInvalid"));
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      setError(t("spend.alertInvalid"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/spend-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyCapRupees,
          alertPct: threshold,
          autoPause,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("spend.saveFailed"));
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-slate-500" aria-hidden="true" />
          {t("spend.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          {t("spend.intro")}
          {limits.weeklyCapRupees == null && ` ${t("spend.noCap")}`}
        </p>

        {evaluation.capRupees != null && (
          <SpendMeter evaluation={evaluation} t={t} />
        )}

        {error && <Alert variant="error">{error}</Alert>}
        {saved && <Alert variant="success">{t("spend.saved")}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cap">{t("spend.capLabel")}</Label>
            <Input
              id="cap"
              type="number"
              min={1}
              disabled={saving}
              inputMode="numeric"
              placeholder={t("spend.capPlaceholder")}
              value={cap}
              onChange={(e) => { setCap(e.target.value); setSaved(false); }}
            />
            <p className="mt-1 text-xs text-slate-500">{t("spend.capHint")}</p>
          </div>
          <div>
            <Label htmlFor="alert">{t("spend.alertLabel")}</Label>
            <Input
              id="alert"
              type="number"
              min={1}
              max={100}
              disabled={saving}
              inputMode="numeric"
              value={alertPct}
              onChange={(e) => { setAlertPct(e.target.value); setSaved(false); }}
            />
          </div>
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={autoPause}
            disabled={saving}
            onChange={(e) => { setAutoPause(e.target.checked); setSaved(false); }}
          />
          <span>
            <span className="font-medium">{t("spend.autoPauseLead")}</span>{" "}
            {t("spend.autoPause")}
          </span>
        </label>

        <details className="text-sm text-slate-600">
          <summary className="flex min-h-11 w-fit cursor-pointer items-center font-medium text-blue-700">{t("spend.howTitle")}</summary>
          <p className="pb-2 text-sm leading-6 text-slate-600">{t("spend.how")}</p>
        </details>

        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("spend.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function SpendMeter({ evaluation, t }: { evaluation: SpendEvaluation; t: ReturnType<typeof settingsTranslator> }) {
  const tone =
    evaluation.status === "over"
      ? "bg-red-500"
      : evaluation.status === "approaching"
        ? "bg-amber-500"
        : "bg-blue-500";
  const width = Math.min(evaluation.pct, 100);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{t("spend.thisWeek")}</span>
        <span className="font-medium text-slate-900">
          {formatMoney(evaluation.usedRupees)} / {formatMoney(evaluation.capRupees ?? 0)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {t("spend.used", { pct: evaluation.pct, left: formatMoney(evaluation.headroomRupees) })}
      </p>
    </div>
  );
}
