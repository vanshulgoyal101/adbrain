"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileX, ImagePlus, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MediaRightsConsent, mediaConsentComplete, type MediaConsentValue } from "@/components/media-rights-consent";
import type { mediaTranslator } from "@/i18n/words";
import {
  MEDIA_PICK_MAX, prepareImage, UploadError, uploadPrepared, type Codec, type Prepared, type UploadDeps,
} from "@/lib/media/client-upload";
import { MEDIA_MIME_TYPES, mediaFitWords } from "@/lib/media/rules";
import type { MediaView } from "@/lib/media/store";
import { createClient } from "@/lib/supabase/client";

type ItemStatus = "checking" | "ready" | "refused" | "uploading" | "added" | "duplicate" | "failed";
export type UploadItem = { key: string; name: string; status: ItemStatus; message: string | null; prepared?: Prepared; thumb?: string };

// Owners don't recognise "IMG_2041.jpg", so each pick shows its own picture (Designer, #1973 review item 2).
// Other files get no preview: the browser would draw a broken image (Designer, #778 walk item 2).
const thumbFor = (file: File) => typeof URL.createObjectURL === "function" && /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : undefined;
const dropThumb = (item: UploadItem) => { if (item.thumb) URL.revokeObjectURL(item.thumb); };

export type MediaT = ReturnType<typeof mediaTranslator>;

/** A photo's fit line in the owner's language (Designer, #778 walk 1). */
export function fitText(t: MediaT, width: number, height: number, kind: "image" | "video" = "image"): string {
  const fit = mediaFitWords(width, height, kind);
  return t(`fit.${fit.key}`, { ratio: fit.ratio === "wide" ? t("fit.landscape") : fit.ratio, width: fit.width });
}

const errorText = (t: MediaT, error: unknown, fallback: "upload.format" | "upload.failed") =>
  !(error instanceof UploadError) ? t(fallback) : error.words ? t(error.words.key, error.words.values) : error.message;

const defaultDeps = (): UploadDeps => ({
  fetch: (...args) => fetch(...args),
  uploadToSignedUrl: (path, token, blob) => createClient().storage.from("media").uploadToSignedUrl(path, token, blob, { contentType: "image/jpeg" }),
});

/**
 * #778 slice 3b: the owner's picked photos and their uploads. Lives on the library (not the sheet) so uploads
 * keep going after the sheet closes. They stop if the page closes, so the tab asks first while one runs (Designer, #1999).
 */
export function useMediaUploads({ t, businessId, onAdded, deps, codec }: {
  t: MediaT;
  businessId: string;
  onAdded: (asset: MediaView) => void;
  deps?: UploadDeps;
  codec?: Codec;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [batch, setBatch] = useState({ total: 0, done: 0, running: 0 });
  const counter = useRef(0);
  const live = useRef<UploadItem[]>([]);
  live.current = items;
  useEffect(() => () => live.current.forEach(dropThumb), []);
  const update = useCallback((key: string, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...change } : item));
  }, []);

  const pick = useCallback(async (files: File[]) => {
    const chosen = files.slice(0, MEDIA_PICK_MAX);
    setLimitNote(files.length > MEDIA_PICK_MAX ? t("upload.limitCount", { max: MEDIA_PICK_MAX }) : null);
    const fresh = chosen.map((file) => ({ file, item: { key: `pick-${++counter.current}`, name: file.name, status: "checking" as const, message: null, thumb: thumbFor(file) } }));
    // Finished uploads drop off the sheet when the owner picks again; anything waiting or failed stays.
    setItems((current) => {
      const done = (item: UploadItem) => item.status === "added" || item.status === "duplicate";
      current.filter(done).forEach(dropThumb);
      return [...current.filter((item) => !done(item)), ...fresh.map(({ item }) => item)];
    });
    await Promise.all(fresh.map(async ({ file, item }) => {
      try {
        const prepared = await prepareImage(file, codec);
        update(item.key, { status: "ready", prepared, message: fitText(t, prepared.width, prepared.height) });
      } catch (error) {
        update(item.key, { status: "refused", message: errorText(t, error, "upload.format") });
      }
    }));
  }, [codec, t, update]);

  const send = useCallback(async (all: UploadItem[]) => {
    const targets = all.flatMap((item) => item.prepared ? [{ ...item, prepared: item.prepared }] : []);
    if (!targets.length) return;
    // A retry or a second pick while a batch runs joins it: "Uploading 3 of 6…".
    setBatch((current) => current.running ? { ...current, total: current.total + targets.length, running: current.running + 1 } : { total: targets.length, done: 0, running: 1 });
    for (const item of targets) {
      update(item.key, { status: "uploading" });
      try {
        const result = await uploadPrepared(businessId, item.prepared, deps ?? defaultDeps());
        update(item.key, { status: result.status, message: result.status === "duplicate" ? t("upload.duplicate") : null });
        if (result.status === "added") onAdded(result.asset);
      } catch (error) {
        update(item.key, { status: "failed", message: errorText(t, error, "upload.failed") });
      }
      setBatch((current) => ({ ...current, done: current.done + 1 }));
    }
    setBatch((current) => ({ ...current, running: current.running - 1 }));
  }, [businessId, deps, onAdded, t, update]);

  const running = batch.running > 0;
  useEffect(() => {
    if (!running) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [running]);

  const progress = batch.running > 0 && batch.done < batch.total ? t("upload.progress", { n: batch.done + 1, total: batch.total }) : null;
  const request: typeof fetch = deps?.fetch ?? ((...args) => fetch(...args));
  return { items, limitNote, progress, pick, send, request };
}

export type MediaUploads = ReturnType<typeof useMediaUploads>;

function ItemLine({ t, item, onRetry }: { t: MediaT; item: UploadItem; onRetry: () => void }) {
  const usableWithLimits = item.status === "ready" && item.prepared?.fit.level === "feed";
  const tone = item.status === "refused" || item.status === "failed" ? "text-red-700" : item.status === "added" ? "text-emerald-700" : usableWithLimits ? "text-amber-800" : "text-slate-600";
  return (
    <li className="flex items-start gap-3 py-2">
      {item.thumb && item.prepared
        ? <img src={item.thumb} alt="" className="h-11 w-11 shrink-0 rounded-md bg-slate-100 object-cover" />
        : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100" aria-hidden="true">
          {item.status === "refused" && <FileX className="h-5 w-5 text-slate-500" />}
        </span>}
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {item.status === "added" || item.status === "duplicate" ? <Check className="h-4 w-4 text-emerald-600" />
          : item.status === "refused" || item.status === "failed" ? <TriangleAlert className="h-4 w-4 text-red-600" />
          : usableWithLimits ? <TriangleAlert className="h-4 w-4 text-amber-600" />
          : item.status === "ready" ? <Check className="h-4 w-4 text-emerald-600" />
          : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{item.name}</span>
        <span className={`block text-xs ${tone}`}>
          {item.status === "checking" ? t("upload.checking") : item.status === "uploading" ? t("upload.uploading") : item.status === "added" ? t("upload.added") : item.message}
        </span>
      </span>
      {item.status === "failed" && item.prepared && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm font-medium text-primary hover:bg-primary/10">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t("upload.tryAgain")}
        </button>
      )}
    </li>
  );
}

/**
 * #778 slice 3b: the picker sheet. Photos only (JPG, PNG, WebP); each file gets its fit line before anything is
 * sent. The rights tick (#1248) shows until the business has confirmed the current terms.
 */
export function MediaUploadSheet({ t, open, onOpenChange, uploads, businessId, vertical, consented, onConsented }: {
  t: MediaT;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploads: MediaUploads;
  businessId: string;
  vertical: string | null;
  consented: boolean;
  onConsented: () => void;
}) {
  const [consent, setConsent] = useState<MediaConsentValue>({ rights: false, people: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const ready = uploads.items.filter((item) => item.status === "ready");
  const busy = uploads.items.some((item) => item.status === "uploading" || item.status === "checking");
  const progress = uploads.progress;
  // The rights tick comes first; Add stays off until it's ticked (Designer, #1973 review item 1).
  const needsTick = !consented && !mediaConsentComplete(consent, vertical);

  async function next() {
    setError(null);
    if (!consented) {
      if (!mediaConsentComplete(consent, vertical)) { setError(t("upload.rightsRequired")); return; }
      setSaving(true);
      try {
        const response = await uploads.request("/api/media/consent", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, rights: consent.rights, people: consent.people }), signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          setError(response.status < 500 && body.error ? body.error : t("upload.consentFailed"));
          return;
        }
        onConsented();
      } catch {
        setError(t("upload.consentFailed"));
        return;
      } finally {
        setSaving(false);
      }
    }
    void uploads.send(ready);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg"
        // Opening focus goes to the first thing to do, not Close (Designer, #778 walk item 5).
        onOpenAutoFocus={(event) => { event.preventDefault(); choose.current?.focus(); }}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">{t("upload.title")}</DialogTitle>
            <DialogDescription className="text-sm text-slate-600">{t("upload.description")}</DialogDescription>
          </div>
          <DialogClose aria-label={t("upload.close")} />
        </div>
        <div className="flex flex-col gap-4 p-4">
          <input ref={input} type="file" multiple accept={MEDIA_MIME_TYPES.join(",")} className="sr-only" aria-label={t("upload.choose")}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void uploads.pick(files);
            }} />
          <button ref={choose} type="button" onClick={() => input.current?.click()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <ImagePlus className="h-4 w-4" aria-hidden="true" /> {t("upload.choose")}
          </button>
          {uploads.limitNote && <p className="text-sm text-amber-800">{uploads.limitNote}</p>}
          {!consented && <MediaRightsConsent t={t} vertical={vertical} value={consent} onChange={setConsent} />}
          {uploads.items.length > 0 && (
            <ul aria-label={t("upload.picks")} className="divide-y divide-slate-100">
              {uploads.items.map((item) => <ItemLine key={item.key} t={t} item={item} onRetry={() => void uploads.send([item])} />)}
            </ul>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {progress && (
            <p role="status" className="text-sm text-slate-700">
              {progress} <span className="text-slate-500">{t("upload.keepOpen")}</span>
            </p>
          )}
          {needsTick && ready.length > 0 && <p className="text-sm text-slate-600">{t("upload.rightsRequired")}</p>}
          <button type="button" onClick={() => void next()} disabled={!ready.length || saving || busy || needsTick}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">
            {t("upload.add", { count: ready.length })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
