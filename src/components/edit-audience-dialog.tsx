"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LocationPicker } from "@/components/targeting-controls";
import { audienceChangeFromForm, emptyAudienceEdit, type AudienceEditForm } from "@/lib/campaign/editor-targeting";

type Preview = { adSets: Array<{ mode: "patch" | "rebuild" }>; consequence: string | null };

/** What the owner reads before saving: which ad sets change and what that costs them. */
function previewWords(preview: Preview): string {
  const count = preview.adSets.length;
  const sets = count === 1 ? "1 ad set" : `${count} ad sets`;
  return preview.consequence
    ? `Meta accepted this change for ${sets}. ${preview.consequence}`
    : `Meta accepted this change for ${sets}. It updates in place, so learning carries on.`;
}

async function send(campaignId: string, body: object): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, message: typeof data.error === "string" ? data.error : "Couldn't change the audience. Nothing changed." };
    return { ok: true, data };
  } catch {
    return { ok: false, message: "No connection. Nothing changed; try again." };
  }
}

/**
 * #773: change a paused campaign's audience (area, extra exclusions, ages, gender). Meta checks the
 * change first (nothing is written), the owner reads the consequence, then saves. Exclusions only grow.
 */
export function EditAudienceDialog({ campaignId, campaignName, onClose, onSaved }: {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = React.useState<AudienceEditForm>(emptyAudienceEdit);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState<"check" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef<string | null>(null);
  const ids = { minAge: React.useId(), maxAge: React.useId(), gender: React.useId(), scope: React.useId() };

  const update = (patch: Partial<AudienceEditForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setPreview(null);
    setError(null);
    key.current = null;
  };
  const age = (raw: string) => raw.trim() === "" ? null : Number(raw);
  const hasCities = [...form.included, ...form.excluded].some(place => place.type === "city");

  const check = async () => {
    const built = audienceChangeFromForm(form);
    if ("error" in built) { setError(built.error); return; }
    key.current ??= crypto.randomUUID();
    setBusy("check");
    setError(null);
    const outcome = await send(campaignId, { change: built.change, preview: true, idempotencyKey: key.current });
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    setPreview(outcome.data.preview as Preview);
  };

  const save = async () => {
    const built = audienceChangeFromForm(form);
    if ("error" in built || !key.current) return;
    setBusy("save");
    setError(null);
    const outcome = await send(campaignId, { change: built.change, idempotencyKey: key.current });
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    const result = outcome.data.result as { consequence?: string | null } | undefined;
    onSaved(`Audience changed. The campaign stays paused.${result?.consequence ? ` ${result.consequence}` : ""}`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-slate-950">Edit audience</DialogTitle>
            <DialogDescription className="mt-0.5 wrap-break-word text-sm text-slate-600">
              {campaignName}. Leave anything blank to keep it as it is.
            </DialogDescription>
          </div>
          <DialogClose aria-label="Close edit audience" disabled={!!busy} />
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-900">New area</h3>
            <p className="text-xs text-slate-600">Replaces where the ads show. The rest of India is left out automatically.</p>
            <LocationPicker value={form.included} onChange={included => update({ included })} placeholder="Search a city or state" tone="include" />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-900">Also leave out</h3>
            <p className="text-xs text-slate-600">Added to the places already left out. Nothing left out is ever put back.</p>
            <LocationPicker value={form.excluded} onChange={excluded => update({ excluded })} placeholder="Search a place to leave out" tone="exclude" />
          </section>

          {hasCities && (
            <fieldset className="flex flex-col gap-2">
              <legend id={ids.scope} className="text-sm font-medium text-slate-900">Around each city</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Select aria-labelledby={ids.scope} value={form.cityScope} onChange={event => update({ cityScope: event.target.value as AudienceEditForm["cityScope"] })} className="h-11 w-auto">
                  <option value="radius">City and nearby</option>
                  <option value="city_only">City only</option>
                </Select>
                {form.cityScope === "radius" && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Input type="number" inputMode="numeric" min={1} max={80} value={form.radiusKm} aria-label="Distance around each city in km"
                      onChange={event => update({ radiusKm: Number(event.target.value) || 1 })} className="h-11 w-20" /> km
                  </label>
                )}
              </div>
            </fieldset>
          )}

          <section className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.minAge} className="text-sm font-medium text-slate-900">Youngest</label>
              <Input id={ids.minAge} type="number" inputMode="numeric" min={18} max={65} placeholder="Keep" className="h-11"
                value={form.ageMin ?? ""} onChange={event => update({ ageMin: age(event.target.value) })} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.maxAge} className="text-sm font-medium text-slate-900">Oldest</label>
              <Input id={ids.maxAge} type="number" inputMode="numeric" min={18} max={65} placeholder="Keep" className="h-11"
                value={form.ageMax ?? ""} onChange={event => update({ ageMax: age(event.target.value) })} />
            </div>
          </section>

          <div className="flex flex-col gap-1">
            <label htmlFor={ids.gender} className="text-sm font-medium text-slate-900">Who sees the ads</label>
            <Select id={ids.gender} value={form.gender} onChange={event => update({ gender: event.target.value as AudienceEditForm["gender"] })} className="h-11">
              <option value="keep">Keep as it is</option>
              <option value="all">Everyone</option>
              <option value="women">Women</option>
              <option value="men">Men</option>
            </Select>
          </div>

          {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
          {preview && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{previewWords(preview)}</p>}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={!!busy}>Cancel</Button>
          {preview ? (
            <Button className="h-11" onClick={() => void save()} disabled={!!busy}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save change
            </Button>
          ) : (
            <Button className="h-11" onClick={() => void check()} disabled={!!busy}>
              {busy === "check" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Check with Meta
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
