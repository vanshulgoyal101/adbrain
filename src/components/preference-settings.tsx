"use client";

import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { preferenceCategories, type PreferenceCategory } from "@/lib/preferences/context";
import type { PreferenceState } from "@/lib/preferences/store";
import { formatDate } from "@/lib/format";
import { settingsTranslator, type Words } from "@/i18n/words";

export function PreferenceSettings({ businessId, initialState = null, words }: {
  businessId: string; initialState?: PreferenceState | null; words?: Words<"settings">;
}) {
  const t = useMemo(() => settingsTranslator(words), [words]);
  const label = (item: PreferenceCategory) => t(`preferences.categories.${item}`);
  const loadFailed = t("preferences.loadFailed");
  const [state, setState] = useState<PreferenceState | null>(initialState);
  const [category, setCategory] = useState<PreferenceCategory>("tone");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const [notice, setNotice] = useState("");
  const serverLoaded = initialState !== null;

  useEffect(() => {
    if (serverLoaded) return;
    let active = true;
    fetch(`/api/preferences?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? loadFailed);
        return body as PreferenceState;
      }).then(result => { if (active) setState(result); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [businessId, serverLoaded, loadFailed]);

  async function change(operation: "enable" | "pause" | "save" | "forget" | "clear", target = category) {
    if (!state) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, operation, expectedEpoch: state.epoch, category: target, value: operation === "save" ? value : undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("preferences.saveFailed"));
      setState(body as PreferenceState);
      if (operation === "save" || operation === "forget" || operation === "clear") setValue("");
      setNotice(t(operation === "save" ? "preferences.saved" : operation === "forget" ? "preferences.forgotten" :
        operation === "clear" ? "preferences.cleared" : operation === "pause" ? "preferences.paused" : "preferences.enabled"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  function exportNotes() {
    if (!state) return;
    const file = new Blob([JSON.stringify(state.notes.map(({ category: noteCategory, value: noteValue, updated_at }) =>
      ({ category: noteCategory, value: noteValue, updated_at })), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "adbrain-preferences.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <section aria-labelledby="preferences-heading" className="space-y-4 border-t border-slate-200 pt-6">
      {confirmDialog}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="preferences-heading" className="text-lg font-semibold text-slate-900">{t("preferences.title")}</h2>
        <p className="text-sm text-slate-600">{t("preferences.intro")}</p>
      </div>
      {state && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={state.enabled} disabled={busy} onChange={() => change(state.enabled ? "pause" : "enable")}
          className="h-4 w-4" />{` ${t("preferences.use")}`}
      </label>}
    </div>
    {error && <Alert variant="error">{error} <button type="button" className="underline" onClick={() => window.location.reload()}>{t("preferences.reload")}</button></Alert>}
    {notice && <Alert variant="success">{notice}</Alert>}
    {!state && !error && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{` ${t("preferences.loading")}`}</p>}
    {state && <>
      {state.enabled && <form className="space-y-3" onSubmit={event => { event.preventDefault(); change("save"); }}>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div><Label htmlFor="preference-category">{t("preferences.category")}</Label>
            <select id="preference-category" value={category} onChange={event => { setCategory(event.target.value as PreferenceCategory); setValue(""); }}
              disabled={busy} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
              {preferenceCategories.map(item => <option key={item} value={item}>{label(item)}</option>)}
            </select></div>
          <div><Label htmlFor="preference-value">{t("preferences.preference")}</Label><Input id="preference-value" maxLength={160} value={value}
            onChange={event => setValue(event.target.value)} disabled={busy} placeholder={t("preferences.placeholder")} /></div>
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t("preferences.remember")}</Button>
      </form>}
      {state.notes.length > 0 && <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {state.notes.map(note => <li key={note.category} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1"><span className="font-medium text-slate-900">{label(note.category)}</span>
            <p className="break-words text-slate-700">{note.value}</p>
            <span className="text-xs text-slate-500">{t("preferences.declared", { date: formatDate(note.updated_at, undefined, words?.locale) })}</span></div>
          <button type="button" title={t("preferences.edit", { label: label(note.category) })} aria-label={t("preferences.edit", { label: label(note.category) })} disabled={busy || !state.enabled}
            onClick={() => { setCategory(note.category); setValue(note.value); document.getElementById("preference-value")?.focus(); }}><Pencil className="h-4 w-4" /></button>
          <button type="button" title={t("preferences.forget", { label: label(note.category) })} aria-label={t("preferences.forget", { label: label(note.category) })} disabled={busy}
            onClick={() => change("forget", note.category)}><Trash2 className="h-4 w-4" /></button>
        </li>)}</ul>}
      {state.notes.length > 0 && <div className="flex flex-wrap gap-4 text-sm font-medium">
        <button type="button" disabled={busy} onClick={exportNotes} className="inline-flex items-center gap-2 text-slate-700 underline">
          <Download className="h-4 w-4" />{` ${t("preferences.export")}`}
        </button>
        <button type="button" disabled={busy} onClick={() => {
          void confirm({ title: t("preferences.forgetAllTitle"), description: t("preferences.forgetAllBody"), confirmLabel: t("preferences.forgetAllConfirm"),
            cancelLabel: t("preferences.cancel"), tone: "danger" })
            .then((confirmed) => { if (confirmed) change("clear"); });
        }} className="text-red-700 underline">{t("preferences.forgetAll")}</button>
      </div>}
    </>}
  </section>;
}