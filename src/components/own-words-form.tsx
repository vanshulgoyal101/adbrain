"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { setCreativeStatus } from "@/app/(app)/studio/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useNotices } from "@/i18n/notices";
import { createAdsTranslator, type Words } from "@/i18n/words";
import { editableCopySchema, type EditableCopy } from "@/lib/creative/concept";
import type { MediaView } from "@/lib/media/store";
import { META_CTAS } from "@/lib/templates/ads";
import type { Creative } from "@/lib/types";
import en from "../../messages/en.json";

type Draft = EditableCopy & { offer: boolean };
export type PhotoPickWords = Pick<Words<"setup">["messages"]["ads"], "tapToPick" | "picked" | "pickOne">;
const EMPTY: Draft = { headline: "", primary_text: "", description: "", cta: META_CTAS[0], offer: false };
const LIMITS = {
  headline: editableCopySchema.shape.headline.maxLength ?? 40,
  primary_text: editableCopySchema.shape.primary_text.maxLength ?? 900,
  description: editableCopySchema.shape.description.maxLength ?? 100,
};

/** #780 slice 2b, "I'll write them": one card per picked photo for the owner's own words; saving calls no AI. */
export function OwnWordsForm({ businessId, photos, words, photoPickWords, overlayAvailable = true, onSaving, onSaved }: {
  businessId: string; photos: MediaView[]; words?: Words<"create">;
  photoPickWords?: PhotoPickWords;
  overlayAvailable?: boolean;
  /** Locks the photos and the mode switch while the save runs, so the request's photos are the ones shown. */
  onSaving?: (saving: boolean) => void; onSaved: () => void;
}) {
  const t = createAdsTranslator(words), lang = words && words.locale !== "en" ? words.locale : undefined;
  const tn = useNotices(), pickWords = photoPickWords ?? en.setup.ads;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ creatives: Creative[]; warnings: string[][]; failed: number } | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const choosingRef = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const draft = (id: string) => drafts[id] ?? EMPTY;
  const set = (id: string, change: Partial<Draft>) => {
    idempotencyKey.current = null;
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY), ...change } }));
  };
  const ready = photos.length > 0 && photos.every((photo) => draft(photo.id).headline.trim() && draft(photo.id).primary_text.trim());

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    onSaving?.(true);
    try {
      const requestKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = requestKey;
      const res = await fetch("/api/creatives/own", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId, idempotencyKey: requestKey,
          items: photos.map((photo) => ({ mediaId: photo.id, ...draft(photo.id), offer: photo.kind === "image" && draft(photo.id).offer })),
        }),
      });
      const body = await res.json().catch(() => null) as { creatives?: Creative[]; warnings?: string[][]; failed?: number; error?: string; code?: string; status?: string } | null;
      if (res.status === 202 || body?.status === "processing") {
        setError(t("ownSavePending"));
        return;
      }
      if (res.status === 400 || res.status === 409 || res.status === 422
        || body?.code === "OWN_WORDS_OVERLAY_UNAVAILABLE" || body?.code === "OWN_WORDS_BATCH_FAILED") {
        idempotencyKey.current = null;
      }
      if (!res.ok || !body?.creatives?.length) {
        setError(body?.error ?? t("ownSaveFailed"));
        return;
      }
      idempotencyKey.current = null;
      setSaved({ creatives: body.creatives, warnings: body.warnings ?? [], failed: body.failed ?? 0 });
      onSaved();
    } catch {
      setError(t("ownSaveFailed"));
    } finally {
      setSaving(false);
      onSaving?.(false);
    }
  }

  async function toggleChoice(creative: Creative) {
    if (choosingRef.current) return;
    choosingRef.current = true;
    setChoosing(creative.id);
    setError(null);
    const next = creative.status === "approved" ? "draft" : "approved";
    const mark = (status: "draft" | "approved") => setSaved((current) => current && ({
      ...current, creatives: current.creatives.map((ad) => ad.id === creative.id ? { ...ad, status } : ad),
    }));
    try {
      const result = await setCreativeStatus(creative.id, next);
      if (result.ok) mark(next);
      else {
        mark("draft");
        setError(tn("assistant.choiceNotSaved"));
      }
    } catch {
      mark("draft");
      setError(tn("assistant.choiceNotSaved"));
    } finally {
      choosingRef.current = false;
      setChoosing(null);
    }
  }

  if (saved) {
    const ids = saved.creatives.filter((creative) => creative.status === "approved").map((creative) => creative.id);
    return (
      <section aria-labelledby="own-saved" lang={lang} className="flex max-w-2xl flex-col gap-3">
        <h2 id="own-saved" role="status" className="text-sm font-semibold text-slate-900">
          {saved.failed ? t("ownSavedSome", { saved: saved.creatives.length, total: saved.creatives.length + saved.failed }) : t("ownSaved", { n: saved.creatives.length })}
        </h2>
        <ul className="flex flex-col gap-3">
          {saved.creatives.map((creative, index) => (
            <li key={creative.id} className="flex gap-3 rounded-md border border-slate-200 p-3">
              {(() => {
                const asset = photos.find((photo) => photo.id === creative.media_asset_id);
                return asset?.kind === "video"
                  ? <video aria-label="Saved video" src={asset.url ?? undefined} muted playsInline controls className="size-16 shrink-0 rounded object-cover" />
                  : creative.image_url ? <img src={creative.image_url} alt="" className="size-16 shrink-0 rounded object-cover" /> : null;
              })()}
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words font-medium text-slate-900">{creative.headline}</p>
                {(saved.warnings[index] ?? []).map((warning) => <p key={warning} className="mt-1 break-words text-xs text-amber-800">{warning}</p>)}
                <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={choosing !== null}
                  aria-pressed={creative.status === "approved"}
                  aria-label={`${creative.status === "approved" ? pickWords.picked : pickWords.tapToPick}: ${creative.headline ?? t("ownAd", { n: index + 1 })}`}
                  onClick={() => void toggleChoice(creative)}>
                  {creative.status === "approved" ? pickWords.picked : pickWords.tapToPick}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-700">{ids.length ? t("selected", { count: ids.length }) : pickWords.pickOne}</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {ids.length > 0 && !choosing && <Link href={`/campaigns?all=1&new=1&creatives=${ids.join(",")}&review=1`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            {t("nextCampaign")} <ArrowRight size={15} aria-hidden="true" />
          </Link>}
          <Link href="/studio" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-blue-700 hover:bg-slate-100">{t("reviewAds")}</Link>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={save} aria-label={t("ownFormLabel")} lang={lang} className="flex max-w-2xl flex-col gap-4">
      {photos.map((photo, index) => {
        const value = draft(photo.id), field = (key: string) => `own-${photo.id}-${key}`;
        const counter = (key: keyof typeof LIMITS) => <span className="text-xs tabular-nums text-slate-400">{value[key].length}/{LIMITS[key]}</span>;
        return (
          <fieldset key={photo.id} disabled={saving} className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-900">
              {photo.kind === "video"
                ? <video aria-label={`Picked video ${index + 1}`} src={photo.url ?? undefined} muted playsInline className="size-10 rounded object-cover" />
                : photo.url && <img src={photo.url} alt="" className="size-10 rounded object-cover" />}
              {t("ownAd", { n: index + 1 })}
            </legend>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between"><Label htmlFor={field("headline")}>{t("ownHeadline")}</Label>{counter("headline")}</div>
              <Input id={field("headline")} value={value.headline} maxLength={LIMITS.headline} required onChange={(e) => set(photo.id, { headline: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between"><Label htmlFor={field("primary_text")}>{t("ownMainText")}</Label>{counter("primary_text")}</div>
              <Textarea id={field("primary_text")} value={value.primary_text} maxLength={LIMITS.primary_text} rows={4} required onChange={(e) => set(photo.id, { primary_text: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between"><Label htmlFor={field("description")}>{t("ownDescription")}</Label>{counter("description")}</div>
              <Input id={field("description")} value={value.description} maxLength={LIMITS.description} onChange={(e) => set(photo.id, { description: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={field("cta")}>{t("ownButton")}</Label>
              <Select id={field("cta")} value={value.cta} onChange={(e) => set(photo.id, { cta: e.target.value as Draft["cta"] })}>
                {META_CTAS.map((cta) => <option key={cta} value={cta}>{cta}</option>)}
              </Select>
            </div>
            {overlayAvailable && photo.kind === "image" && <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700">
              <input type="checkbox" checked={value.offer} onChange={(e) => set(photo.id, { offer: e.target.checked })} className="size-5 accent-primary" />
              {t("ownOnPhoto")}
            </label>}
          </fieldset>
        );
      })}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!ready || saving} className="min-h-11 self-start">
        {saving ? t("ownSaving") : t("ownSave", { n: photos.length })}
      </Button>
    </form>
  );
}
