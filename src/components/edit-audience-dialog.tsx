"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LocationPicker } from "@/components/targeting-controls";
import { audienceChangeFromForm, emptyAudienceEdit, type AudienceEditForm } from "@/lib/campaign/editor-targeting";
import { AD_LANGUAGES } from "@/lib/meta/locales";
import { campaignsTranslator, type Words } from "@/i18n/words";

type Preview = { adSets: Array<{ mode: "patch" | "rebuild" }>; consequence: string | null };

type T = ReturnType<typeof campaignsTranslator>;

/** What the owner reads before saving: which ad sets change and what that costs them. The consequence is the server's. */
function previewWords(preview: Preview, t: T): string {
  return `${t("audienceEdit.accepted", { n: preview.adSets.length })} ${preview.consequence ?? t("audienceEdit.inPlace")}`;
}

async function send(campaignId: string, body: object, t: T): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/audience`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, message: typeof data.error === "string" ? data.error : t("audienceEdit.failed") };
    return { ok: true, data };
  } catch {
    return { ok: false, message: t("audienceEdit.offline") };
  }
}

/**
 * #773: change a campaign's audience (area, extra exclusions, ages, gender, language). On a paused campaign Meta checks
 * the change first (nothing is written), the owner reads the consequence, then saves. On a running campaign the change
 * is saved for its next run with no Meta call. Exclusions only grow.
 */
export function EditAudienceDialog({ campaignId, campaignName, running = false, prepared = null, onClose, onSaved, words }: {
  campaignId: string;
  campaignName: string;
  /** #773: a running campaign isn't changed; Save keeps the change for its next run. */
  running?: boolean;
  /** The change saved earlier for the next run; the form starts from it. */
  prepared?: AudienceEditForm | null;
  onClose: () => void;
  /** `prepared` is the form a running Save kept for the next run. */
  onSaved: (message: string, prepared?: AudienceEditForm) => void;
  /** #1438: the dialog's words in the owner's language; English without. */
  words?: Words<"campaigns">;
}) {
  const t = campaignsTranslator(words);
  const [form, setForm] = React.useState<AudienceEditForm>(prepared ?? emptyAudienceEdit);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState<"check" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef<string | null>(null);
  const ids = { minAge: React.useId(), maxAge: React.useId(), gender: React.useId(), scope: React.useId(), language: React.useId() };

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
    if ("error" in built) { setError(t(`audienceEdit.errors.${built.code}`)); return; }
    key.current ??= crypto.randomUUID();
    setBusy("check");
    setError(null);
    const outcome = await send(campaignId, { change: built.change, preview: true, idempotencyKey: key.current }, t);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    setPreview(outcome.data.preview as Preview);
  };

  const save = async () => {
    const built = audienceChangeFromForm(form);
    if ("error" in built) { setError(t(`audienceEdit.errors.${built.code}`)); return; }
    if (!running && !key.current) return;
    key.current ??= crypto.randomUUID();
    setBusy("save");
    setError(null);
    const outcome = await send(campaignId, { change: built.change, idempotencyKey: key.current, ...running ? { form } : {} }, t);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    const result = outcome.data.result as { consequence?: string | null; prepared?: true } | undefined;
    if (result?.prepared) { onSaved(t("audienceEdit.savedNextRun"), form); return; }
    onSaved(`${t("audienceEdit.changed")}${result?.consequence ? ` ${result.consequence}` : ""}`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-slate-950">{t("audienceEdit.title")}</DialogTitle>
            <DialogDescription className="mt-0.5 wrap-break-word text-sm text-slate-600">
              {t("audienceEdit.description", { name: campaignName })}
            </DialogDescription>
          </div>
          <DialogClose aria-label={t("audienceEdit.close")} disabled={!!busy} />
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-900">{t("audienceEdit.newArea")}</h3>
            <p className="text-xs text-slate-600">{t("audienceEdit.newAreaHelp")}</p>
            <LocationPicker value={form.included} onChange={included => update({ included })} placeholder={t("audienceEdit.searchArea")} tone="include" words={words} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-slate-900">{t("audienceEdit.alsoLeaveOut")}</h3>
            <p className="text-xs text-slate-600">{t("audienceEdit.alsoLeaveOutHelp")}</p>
            <LocationPicker value={form.excluded} onChange={excluded => update({ excluded })} placeholder={t("audienceEdit.searchLeaveOut")} tone="exclude" words={words} />
            {!running && !form.included.length && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.areaExclusions} onChange={event => update({ areaExclusions: event.target.checked })} />
                <span>
                  <span className="font-medium">{t("audienceEdit.areaExclusions")}</span>
                  <span className="block text-xs text-slate-600">{t("audienceEdit.areaExclusionsHelp")}</span>
                </span>
              </label>
            )}
          </section>

          {hasCities && (
            <fieldset className="flex flex-col gap-2">
              <legend id={ids.scope} className="text-sm font-medium text-slate-900">{t("audienceEdit.aroundCity")}</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Select aria-labelledby={ids.scope} value={form.cityScope} onChange={event => update({ cityScope: event.target.value as AudienceEditForm["cityScope"] })} className="h-11 w-auto">
                  <option value="radius">{t("audienceEdit.cityAndNearby")}</option>
                  <option value="city_only">{t("audienceEdit.cityOnly")}</option>
                </Select>
                {form.cityScope === "radius" && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Input type="number" inputMode="numeric" min={running ? 5 : 1} max={80} value={form.radiusKm} aria-label={t("audienceEdit.radiusLabel")}
                      onChange={event => update({ radiusKm: Number(event.target.value) || 1 })} className="h-11 w-20" /> {t("audienceEdit.km")}
                  </label>
                )}
              </div>
            </fieldset>
          )}

          <section className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.minAge} className="text-sm font-medium text-slate-900">{t("audienceEdit.youngest")}</label>
              <Input id={ids.minAge} type="number" inputMode="numeric" min={18} max={65} placeholder={t("audienceEdit.keep")} className="h-11"
                value={form.ageMin ?? ""} onChange={event => update({ ageMin: age(event.target.value) })} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.maxAge} className="text-sm font-medium text-slate-900">{t("audienceEdit.oldest")}</label>
              <Input id={ids.maxAge} type="number" inputMode="numeric" min={18} max={65} placeholder={t("audienceEdit.keep")} className="h-11"
                value={form.ageMax ?? ""} onChange={event => update({ ageMax: age(event.target.value) })} />
            </div>
          </section>

          <div className="flex flex-col gap-1">
            <label htmlFor={ids.gender} className="text-sm font-medium text-slate-900">{t("audienceEdit.who")}</label>
            <Select id={ids.gender} value={form.gender} onChange={event => update({ gender: event.target.value as AudienceEditForm["gender"] })} className="h-11">
              <option value="keep">{t("audienceEdit.keepAsIs")}</option>
              <option value="all">{t("audienceEdit.everyone")}</option>
              <option value="women">{t("audienceEdit.women")}</option>
              <option value="men">{t("audienceEdit.men")}</option>
            </Select>
          </div>

          {!running && <div className="flex flex-col gap-2">
            <label htmlFor={ids.language} className="text-sm font-medium text-slate-900">{t("audienceEdit.language")}</label>
            <Select id={ids.language} value={form.languageMode} onChange={event => update({ languageMode: event.target.value as AudienceEditForm["languageMode"] })} className="h-11">
              <option value="keep">{t("audienceEdit.keepAsIs")}</option>
              <option value="any">{t("audienceEdit.anyLanguage")}</option>
              <option value="only">{t("audienceEdit.onlyLanguages")}</option>
            </Select>
            {form.languageMode === "only" && (
              <>
                <p className="text-xs text-slate-600">{t("audienceEdit.languageHelp")}</p>
                <div className="flex flex-wrap gap-2">
                  {AD_LANGUAGES.map(language => {
                    const on = form.languages.includes(language.key);
                    return (
                      <label key={language.key} className={`flex h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-800"}`}>
                        <input type="checkbox" className="h-4 w-4" checked={on}
                          onChange={() => update({ languages: on ? form.languages.filter(key => key !== language.key) : [...form.languages, language.key] })} />
                        {language.name}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>}

          {running && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{t("audienceEdit.nextRun")}</p>}
          {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
          {preview && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{previewWords(preview, t)}</p>}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={!!busy}>{t("audienceEdit.cancel")}</Button>
          {running || preview ? (
            <Button className="h-11" onClick={() => void save()} disabled={!!busy}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {running ? t("audienceEdit.saveNextRun") : t("audienceEdit.save")}
            </Button>
          ) : (
            <Button className="h-11" onClick={() => void check()} disabled={!!busy}>
              {busy === "check" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("audienceEdit.check")}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
