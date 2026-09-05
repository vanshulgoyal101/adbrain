"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { SpendEvaluation, SpendLimits } from "@/lib/campaign/spend";
import { formatCurrency } from "@/lib/utils";

export function SpendGuardrails({
  limits,
  evaluation,
}: {
  limits: SpendLimits;
  evaluation: SpendEvaluation;
}) {
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
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/spend-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyCapRupees: cap.trim() === "" ? null : Number(cap),
          alertPct: Number(alertPct),
          autoPause,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
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
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          Spend guardrails
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Set a weekly ad-spend ceiling. AdBrain warns you as you approach it and
          won’t let you turn on campaigns that would commit more than your cap.
        </p>

        {limits.weeklyCapRupees == null && (
          <Alert variant="warning">
            No spend cap is set — active campaigns can spend without any limit.
            Set a weekly cap below to turn on overspend protection.
          </Alert>
        )}

        {evaluation.capRupees != null && (
          <SpendMeter evaluation={evaluation} />
        )}

        {error && <Alert variant="error">{error}</Alert>}
        {saved && <Alert variant="success">Saved.</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cap">Weekly cap (₹)</Label>
            <Input
              id="cap"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="No cap"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">Leave blank for no cap.</p>
          </div>
          <div>
            <Label htmlFor="alert">Warn at (% of cap)</Label>
            <Input
              id="alert"
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={alertPct}
              onChange={(e) => setAlertPct(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={autoPause}
            onChange={(e) => setAutoPause(e.target.checked)}
          />
          <span>
            <span className="font-medium">Auto-pause at the cap.</span> When
            tracked spend reaches your weekly cap, pause every active campaign
            automatically (checked whenever results refresh).
          </span>
        </label>

        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save guardrails
        </Button>
      </CardContent>
    </Card>
  );
}

function SpendMeter({ evaluation }: { evaluation: SpendEvaluation }) {
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
        <span className="text-slate-600">This week</span>
        <span className="font-medium text-slate-900">
          {formatCurrency(evaluation.usedRupees)} / {formatCurrency(evaluation.capRupees ?? 0)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {evaluation.pct}% used · {formatCurrency(evaluation.headroomRupees)} left
      </p>
    </div>
  );
}
