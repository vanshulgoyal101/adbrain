"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { preferenceCategories, type PreferenceCategory } from "@/lib/preferences/context";
import type { PreferenceState } from "@/lib/preferences/store";

const labels: Record<PreferenceCategory, string> = {
  copy_length: "Copy length", tone: "Tone", language: "Language", visual_style: "Visual style",
  layout_density: "Layout density", creative_dislikes: "Creative dislikes", workflow: "Workflow",
};

export function PreferenceSettings({ businessId }: { businessId: string }) {
  const [state, setState] = useState<PreferenceState | null>(null);
  const [category, setCategory] = useState<PreferenceCategory>("tone");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/preferences?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load preferences.");
        return body as PreferenceState;
      }).then(result => { if (active) setState(result); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [businessId]);

  async function change(operation: "enable" | "pause" | "save" | "forget" | "clear", target = category) {
    if (!state) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, operation, expectedEpoch: state.epoch, category: target, value: operation === "save" ? value : undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save preferences.");
      setState(body as PreferenceState);
      if (operation === "save" || operation === "forget" || operation === "clear") setValue("");
      setNotice(operation === "save" ? "Preference saved." : operation === "forget" ? "Preference forgotten." :
        operation === "clear" ? "All preferences cleared." : operation === "pause" ? "Preferences paused." : "Preferences enabled.");
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="preferences-heading" className="text-lg font-semibold text-slate-900">Remembered preferences</h2>
        <p className="text-sm text-slate-600">Your creative defaults, separate from required Brand instructions. Your current request always wins.</p>
      </div>
      {state && <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={state.enabled} disabled={busy} onChange={() => change(state.enabled ? "pause" : "enable")}
          className="h-4 w-4" /> Use preferences
      </label>}
    </div>
    {error && <Alert variant="error">{error} <button type="button" className="underline" onClick={() => window.location.reload()}>Reload</button></Alert>}
    {notice && <Alert variant="success">{notice}</Alert>}
    {!state && !error && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading preferences</p>}
    {state && <>
      {state.enabled && <form className="space-y-3" onSubmit={event => { event.preventDefault(); change("save"); }}>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div><Label htmlFor="preference-category">Category</Label>
            <select id="preference-category" value={category} onChange={event => { setCategory(event.target.value as PreferenceCategory); setValue(""); }}
              disabled={busy} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
              {preferenceCategories.map(item => <option key={item} value={item}>{labels[item]}</option>)}
            </select></div>
          <div><Label htmlFor="preference-value">Preference</Label><Input id="preference-value" maxLength={160} value={value}
            onChange={event => setValue(event.target.value)} disabled={busy} placeholder="Usually prefers simple, conversational copy" /></div>
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remember preference</Button>
      </form>}
      {state.notes.length > 0 && <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {state.notes.map(note => <li key={note.category} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1"><span className="font-medium text-slate-900">{labels[note.category]}</span>
            <p className="break-words text-slate-700">{note.value}</p>
            <span className="text-xs text-slate-500">Declared by you · Updated {new Date(note.updated_at).toLocaleDateString()}</span></div>
          <button type="button" title={`Edit ${labels[note.category]}`} aria-label={`Edit ${labels[note.category]}`} disabled={busy || !state.enabled}
            onClick={() => { setCategory(note.category); setValue(note.value); document.getElementById("preference-value")?.focus(); }}><Pencil className="h-4 w-4" /></button>
          <button type="button" title={`Forget ${labels[note.category]}`} aria-label={`Forget ${labels[note.category]}`} disabled={busy}
            onClick={() => change("forget", note.category)}><Trash2 className="h-4 w-4" /></button>
        </li>)}</ul>}
      {state.notes.length > 0 && <div className="flex flex-wrap gap-4 text-sm font-medium">
        <button type="button" disabled={busy} onClick={exportNotes} className="inline-flex items-center gap-2 text-slate-700 underline">
          <Download className="h-4 w-4" /> Export preferences
        </button>
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm("Forget all remembered preferences for this business?")) change("clear");
        }} className="text-red-700 underline">Forget all preferences</button>
      </div>}
    </>}
  </section>;
}