"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { budgetChangeFromForm, initialBudgetForm, localDay, type BudgetAfter, type BudgetForm, type BudgetFormStart } from "@/lib/campaign/budget-edit-form";
import { formatDay, formatMoney } from "@/lib/format";
import { campaignsTranslator, type Words } from "@/i18n/words";

type State = BudgetAfter & { spentRupees: number };
type Preview = { before: State; after: State; needsConfirmation: boolean; confirmationDigest: string | null; notices: string[] };

/** Meta allows one budget change per ad set every 30 s and counts the check in it (#774). */
export const META_WAIT_MS = 30_000;

type T = ReturnType<typeof campaignsTranslator>;

/** The change in plain words, before saving. */
function budgetWords(preview: Pick<Preview, "before" | "after">, t: T): string {
  const { before, after } = preview;
  const day = (iso: string | null) => iso ? formatDay(iso) : t("budgetEdit.noEnd");
  const parts = [
    before.dailyRupees !== after.dailyRupees && t("budgetEdit.dailyChange", { was: formatMoney(before.dailyRupees), now: formatMoney(after.dailyRupees) }),
    before.capRupees !== after.capRupees && t("budgetEdit.capChange", { was: formatMoney(before.capRupees ?? 0), now: formatMoney(after.capRupees ?? 0) }),
    before.endTime !== after.endTime && t("budgetEdit.endChange", { was: day(before.endTime), now: day(after.endTime) }),
  ].filter(Boolean);
  return t("budgetEdit.accepted", { changes: parts.join("; ") });
}

const clockMs = () => Date.now();

async function send(campaignId: string, body: object, t: T): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/budget`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, message: typeof data.error === "string" ? data.error : t("budgetEdit.failed") };
    return { ok: true, data };
  } catch {
    return { ok: false, message: t("budgetEdit.offline") };
  }
}

/**
 * #774: Manage → Edit budget. A capped run changes its total and end date; an uncapped one its daily
 * budget. Meta checks the change first (nothing is written), the owner reads it in plain words and
 * confirms anything above what they approved, then saves with the same key.
 */
export function EditBudgetDialog({ campaignId, campaignName, start, onClose, onSaved, words }: {
  campaignId: string;
  campaignName: string;
  start: BudgetFormStart;
  onClose: () => void;
  onSaved: (message: string, after: BudgetAfter) => void;
  /** #1438: the dialog's words in the owner's language; English without. */
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  const [form, setForm] = React.useState<BudgetForm>(() => initialBudgetForm(start));
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [checkedAt, setCheckedAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState<"check" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef<string | null>(null);
  const ids = { daily: React.useId(), cap: React.useId(), end: React.useId() };

  const waitSeconds = preview ? Math.max(0, Math.ceil((checkedAt + META_WAIT_MS - now) / 1000)) : 0;
  React.useEffect(() => {
    if (!preview || waitSeconds === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview, waitSeconds]);

  const update = (patch: Partial<BudgetForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setPreview(null);
    setError(null);
    key.current = null;
  };

  const check = async () => {
    const built = budgetChangeFromForm(start, form);
    if ("error" in built) { setError(t(`budgetEdit.errors.${built.error}`)); return; }
    key.current ??= crypto.randomUUID();
    setBusy("check");
    setError(null);
    const outcome = await send(campaignId, { change: built.change, preview: true, idempotencyKey: key.current }, t);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    setPreview(outcome.data.preview as Preview);
    const checkedNow = clockMs(); setCheckedAt(checkedNow); setNow(checkedNow);
  };

  const save = async () => {
    const built = budgetChangeFromForm(start, form);
    if ("error" in built || !key.current || !preview) return;
    setBusy("save");
    setError(null);
    const outcome = await send(campaignId, {
      change: built.change, idempotencyKey: key.current, ...preview.confirmationDigest ? { confirmationDigest: preview.confirmationDigest } : {},
    }, t);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    const result = outcome.data.result as { after: BudgetAfter; notices?: string[] };
    onSaved(`${t("budgetEdit.changed")}${result.notices?.length ? ` ${result.notices.join(" ")}` : ""}`, result.after);
  };

  const confirmLabel = preview?.needsConfirmation
    ? start.capped ? t("budgetEdit.confirmCapped") : t("budgetEdit.confirmDaily", { money: formatMoney(preview.after.dailyRupees) })
    : t("budgetEdit.save");

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-slate-950">{t("budgetEdit.title")}</DialogTitle>
            <DialogDescription className="mt-0.5 wrap-break-word text-sm text-slate-600">
              {t(start.capped ? "budgetEdit.descriptionCapped" : "budgetEdit.descriptionDaily", { name: campaignName })}
            </DialogDescription>
          </div>
          <DialogClose aria-label={t("budgetEdit.close")} disabled={!!busy} />
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          {start.capped ? (
            <section className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.cap} className="text-sm font-medium text-slate-900">{t("budgetEdit.cap")}</label>
                <Input id={ids.cap} type="number" inputMode="decimal" min={1} step="any" className="h-11"
                  value={form.cap} onChange={event => update({ cap: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.end} className="text-sm font-medium text-slate-900">{t("budgetEdit.endsOn")}</label>
                <Input id={ids.end} type="date" className="h-11" min={localDay(new Date(now).toISOString())}
                  value={form.endDate} onChange={event => update({ endDate: event.target.value })} />
              </div>
            </section>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.daily} className="text-sm font-medium text-slate-900">{t("budgetEdit.daily")}</label>
              <Input id={ids.daily} type="number" inputMode="decimal" min={1} step="any" className="h-11"
                value={form.daily} onChange={event => update({ daily: event.target.value })} />
              <p className="text-xs text-slate-600">{t("budgetEdit.smallSteps")}</p>
            </div>
          )}

          {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
          {preview && (
            <div role="status" className="flex flex-col gap-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <p>{budgetWords(preview, t)}</p>
              {preview.notices.map(notice => <p key={notice}>{notice}</p>)}
              {preview.needsConfirmation && <p className="font-medium">{t("budgetEdit.needsConfirmation")}</p>}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={!!busy}>{t("budgetEdit.cancel")}</Button>
          {preview ? (
            <Button className="h-11" onClick={() => void save()} disabled={!!busy || waitSeconds > 0}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {waitSeconds > 0 ? t("budgetEdit.wait", { s: waitSeconds }) : confirmLabel}
            </Button>
          ) : (
            <Button className="h-11" onClick={() => void check()} disabled={!!busy}>
              {busy === "check" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("budgetEdit.check")}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
