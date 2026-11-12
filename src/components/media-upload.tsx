"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, FileX, ImagePlus, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MediaRightsConsent, mediaConsentComplete, type MediaConsentValue } from "@/components/media-rights-consent";
import type { mediaTranslator } from "@/i18n/words";
import {
  MEDIA_PICK_MAX, megabytes, prepareImage, prepareVideo, UploadError, uploadPrepared, type Codec, type Prepared, type UploadDeps, type VideoReader,
} from "@/lib/media/client-upload";
import { MEDIA_MIME_TYPES, MEDIA_VIDEO_MAX_BYTES, MEDIA_VIDEO_MAX_SECONDS, MEDIA_VIDEO_MIME_TYPES, mediaFitWords } from "@/lib/media/rules";
import type { MediaView } from "@/lib/media/store";
import { createClient } from "@/lib/supabase/client";

type ItemStatus = "checking" | "ready" | "refused" | "queued" | "uploading" | "added" | "duplicate" | "failed";
export type UploadItem = { key: string; name: string; status: ItemStatus; message: string | null; prepared?: Prepared; thumb?: string };

// Owners don't recognise "IMG_2041.jpg", so each pick shows its own picture (Designer, #1973 review item 2).
// Other files get no preview: the browser would draw a broken image (Designer, #778 walk item 2).
const thumbFor = (file: File) => typeof URL.createObjectURL === "function" && /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : undefined;
const dropThumb = (item: UploadItem) => { if (item.thumb) URL.revokeObjectURL(item.thumb); };

export type MediaT = ReturnType<typeof mediaTranslator>;

/** A photo's fit line in the owner's language (Designer, #778 walk 1). */
export function fitText(t: MediaT, width: number, height: number, kind: "image" | "video" = "image"): string {
  const fit = mediaFitWords(width, height, kind);
  if (kind === "video" && fit.key === "wide") return t("fit.wideVideo", { ratio: fit.ratio === "wide" ? t("fit.landscape") : fit.ratio });
  return t(`fit.${fit.key}`, { ratio: fit.ratio === "wide" ? t("fit.landscape") : fit.ratio, width: fit.width });
}

const errorText = (t: MediaT, error: unknown, fallback: "upload.format" | "upload.failed") =>
  !(error instanceof UploadError) ? t(fallback) : error.words ? t(error.words.key, error.words.values) : error.message;

const defaultDeps = (): UploadDeps => ({
  fetch: (...args) => fetch(...args),
  // TODO(#2820): resume interrupted videos after signed-token TUS is proven.
  uploadToSignedUrl: (bucket, path, token, blob, mime) => createClient().storage.from(bucket).uploadToSignedUrl(path, token, blob, { contentType: mime }),
});

/**
 * #778 slice 3b: the owner's picked photos and their uploads. Lives on the library (not the sheet) so uploads
 * keep going after the sheet closes. They stop if the page closes, so the tab asks first while one runs (Designer, #1999).
 */
export function useMediaUploads({ t, businessId, onAdded, deps, codec, videoReader }: {
  t: MediaT;
  businessId: string;
  onAdded: (asset: MediaView) => void;
  deps?: UploadDeps;
  codec?: Codec;
  videoReader?: VideoReader;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [batch, setBatch] = useState({ total: 0, done: 0, running: 0 });
  const [videoAttempts, setVideoAttempts] = useState(0);
  const counter = useRef(0);
  const inFlight = useRef(new Set<string>());
  const live = useRef<UploadItem[]>([]);
  const videoQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => () => live.current.forEach(dropThumb), []);
  const changeItems = useCallback((change: (current: UploadItem[]) => UploadItem[]) => {
    live.current = change(live.current);
    setItems(live.current);
  }, []);
  const update = useCallback((key: string, change: Partial<UploadItem>) => {
    changeItems((current) => current.map((item) => item.key === key ? { ...item, ...change } : item));
  }, [changeItems]);

  const pick = useCallback(async (files: File[], allowVideo = false) => {
    const chosen = files.slice(0, MEDIA_PICK_MAX);
    setLimitNote(files.length > MEDIA_PICK_MAX ? t("upload.limitCount", { max: MEDIA_PICK_MAX }) : null);
    const fresh = chosen.map((file) => ({ file, item: { key: `pick-${++counter.current}`, name: file.name, status: "checking" as const, message: null, thumb: thumbFor(file) } }));
    // Finished uploads drop off the sheet when the owner picks again; anything waiting or failed stays.
    changeItems((current) => {
      const done = (item: UploadItem) => item.status === "added" || item.status === "duplicate";
      current.filter(done).forEach(dropThumb);
      return [...current.filter((item) => !done(item)), ...fresh.map(({ item }) => item)];
    });
    await Promise.all(fresh.map(async ({ file, item }) => {
      try {
        let prepared: Prepared | null;
        if (allowVideo && file.type.startsWith("video/")) {
          const next = videoQueue.current.then(() =>
            live.current.some((entry) => entry.key === item.key) ? prepareVideo(file, videoReader) : null);
          videoQueue.current = next.then(() => undefined, () => undefined);
          prepared = await next;
        } else prepared = await prepareImage(file, codec);
        if (!prepared) return;
        update(item.key, { status: "ready", prepared, message: fitText(t, prepared.width, prepared.height, prepared.kind) });
      } catch (error) {
        update(item.key, { status: "refused", message: errorText(t, error, "upload.format") });
      }
    }));
  }, [changeItems, codec, t, update, videoReader]);

  const send = useCallback(async (all: UploadItem[]) => {
    const targets: (UploadItem & { prepared: Prepared })[] = [];
    for (const selected of all) {
      const item = live.current.find((entry) => entry.key === selected.key);
      if (!item?.prepared || (item.status !== "ready" && item.status !== "failed") || inFlight.current.has(item.key)) continue;
      inFlight.current.add(item.key);
      targets.push({ ...item, prepared: item.prepared });
    }
    if (!targets.length) return;
    targets.forEach((item) => update(item.key, { status: "queued" }));
    // A retry or a second pick while a batch runs joins it: "Uploading 3 of 6…".
    setBatch((current) => current.running ? { ...current, total: current.total + targets.length, running: current.running + 1 } : { total: targets.length, done: 0, running: 1 });
    for (const item of targets) {
      update(item.key, { status: "uploading" });
      try {
        const result = await uploadPrepared(businessId, item.prepared, deps ?? defaultDeps(),
          item.prepared.kind === "video" ? { onSigned: () => setVideoAttempts((count) => count + 1) } : undefined);
        update(item.key, { status: result.status, message: result.status === "duplicate" ? t("upload.duplicate") : null });
        onAdded(result.asset);
      } catch (error) {
        update(item.key, { status: "failed", message: errorText(t, error, "upload.failed") });
      } finally {
        inFlight.current.delete(item.key);
        if (item.prepared.kind === "video") setVideoAttempts((count) => count + 1);
        setBatch((current) => ({ ...current, done: current.done + 1 }));
      }
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
  const remove = useCallback((key: string) => {
    changeItems((current) => {
      const item = current.find((entry) => entry.key === key);
      if (!item || item.status === "uploading" || inFlight.current.has(key)) return current;
      dropThumb(item);
      return current.filter((entry) => entry.key !== key);
    });
  }, [changeItems]);
  const request: typeof fetch = useCallback((...args) => (deps?.fetch ?? fetch)(...args), [deps?.fetch]);
  return { items, limitNote, progress, pick, send, remove, request, videoAttempts };
}

export type MediaUploads = ReturnType<typeof useMediaUploads>;

function ItemLine({ t, item, onRetry, onRemove, allowVideo }: { t: MediaT; item: UploadItem; onRetry: () => void; onRemove: () => void; allowVideo: boolean }) {
  const usableWithLimits = item.status === "ready" && item.prepared?.fit.level === "feed";
  const tone = item.status === "refused" || item.status === "failed" ? "text-red-700" : item.status === "added" ? "text-emerald-700" : usableWithLimits ? "text-amber-800" : "text-slate-600";
  return (
    <li className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-start gap-x-3 py-2">
      {item.thumb && item.prepared
        ? item.prepared.kind === "video"
          ? <video src={item.thumb} muted playsInline preload="metadata" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-md bg-slate-100 object-cover" />
          : <img src={item.thumb} alt="" className="h-11 w-11 shrink-0 rounded-md bg-slate-100 object-cover" />
        : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100" aria-hidden="true">
          {item.status === "refused" && <FileX className="h-5 w-5 text-slate-500" />}
        </span>}
      <span className="col-start-2 row-start-1 min-w-0">
        <span className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {item.status === "added" || item.status === "duplicate" ? <Check className="h-4 w-4 text-emerald-600" />
              : item.status === "refused" || item.status === "failed" ? <TriangleAlert className="h-4 w-4 text-red-600" />
              : usableWithLimits ? <TriangleAlert className="h-4 w-4 text-amber-600" />
              : item.status === "ready" ? <Check className="h-4 w-4 text-emerald-600" />
              : item.status === "queued" ? <Clock className="h-4 w-4 text-slate-400" />
              : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-slate-900">{item.name}</span>
        </span>
        {item.prepared?.kind === "video" && <span className="block text-xs text-slate-500">{megabytes(item.prepared.bytes)}</span>}
        <span className={`block break-words text-xs ${tone}`}>
          {item.status === "checking" ? t("upload.checking") : item.status === "queued" ? t("upload.queued") : item.status === "uploading" ? t("upload.uploading") : item.status === "added" ? t("upload.added") : item.message}
        </span>
        {item.status === "uploading" && <progress aria-label={t("upload.uploading")} className="mt-1 h-1 w-full" />}
      </span>
      {item.status === "failed" && item.prepared && (
        <button type="button" onClick={onRetry} disabled={item.prepared.kind === "video" && !allowVideo}
          className="col-span-2 col-start-2 row-start-2 inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md px-3 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t("upload.tryAgain")}
        </button>
      )}
      {item.status !== "queued" && item.status !== "uploading" && (
        <button type="button" onClick={onRemove} aria-label={t("upload.remove", { name: item.name })}
          className="col-start-3 row-start-1 inline-flex size-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

type VideoQuota = { enabled: boolean; used: number; limit: number; maxSeconds: number; maxBytes: number };

function videoQuota(value: unknown): VideoQuota | null {
  if (!value || typeof value !== "object" || !("uploads" in value) || !value.uploads || typeof value.uploads !== "object"
    || !("videos" in value.uploads) || !value.uploads.videos || typeof value.uploads.videos !== "object") return null;
  const videos = value.uploads.videos;
  if (!("enabled" in videos) || typeof videos.enabled !== "boolean" || !("used" in videos) || typeof videos.used !== "number"
    || !Number.isSafeInteger(videos.used) || videos.used < 0 || !("limit" in videos) || typeof videos.limit !== "number"
    || !Number.isSafeInteger(videos.limit) || videos.limit < 1 || !("maxSeconds" in videos) || videos.maxSeconds !== MEDIA_VIDEO_MAX_SECONDS
    || !("maxBytes" in videos) || videos.maxBytes !== MEDIA_VIDEO_MAX_BYTES) return null;
  return { enabled: videos.enabled, used: videos.used, limit: videos.limit, maxSeconds: videos.maxSeconds, maxBytes: videos.maxBytes };
}

/**
 * The picker checks each file before sending. The rights tick shows until the business confirms the current terms.
 */
export function MediaUploadSheet({ t, open, onOpenChange, uploads, businessId, vertical, consented, onConsented, videoEnabled = false }: {
  t: MediaT;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploads: MediaUploads;
  businessId: string;
  vertical: string | null;
  consented: boolean;
  onConsented: () => void;
  videoEnabled?: boolean;
}) {
  const [consent, setConsent] = useState<MediaConsentValue>({ rights: false, people: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [quotaResult, setQuotaResult] = useState<{ key: string; quota: VideoQuota | null; state: "ready" | "unavailable" | "error" } | null>(null);
  const [quotaRetries, setQuotaRetries] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const { request, videoAttempts } = uploads;
  const quotaKey = `${businessId}:${quotaRetries}:${videoAttempts}`;
  const currentQuota = open && videoEnabled && quotaResult?.key === quotaKey ? quotaResult : null;
  const quota = currentQuota?.quota ?? null;
  const quotaState = currentQuota?.state ?? "loading";
  const allowVideo = videoEnabled && quotaState === "ready";
  const ready = uploads.items.filter((item) => item.status === "ready" && (item.prepared?.kind !== "video" || allowVideo));
  const busy = uploads.items.some((item) => item.status === "queued" || item.status === "uploading" || item.status === "checking");
  const progress = uploads.progress;
  const hasVideo = uploads.items.some((item) => item.prepared?.kind === "video");
  const readyVideos = ready.filter((item) => item.prepared?.kind === "video").length;
  const rightsRequired = t(hasVideo ? "upload.rightsRequiredMedia" : "upload.rightsRequired");
  // The rights tick comes first; Add stays off until it's ticked (Designer, #1973 review item 1).
  const needsTick = !consented && !mediaConsentComplete(consent, vertical);

  useEffect(() => {
    if (!open || !videoEnabled) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let active = true;
    void (async () => {
      try {
        const response = await request(`/api/media?businessId=${encodeURIComponent(businessId)}`, { signal: controller.signal });
        const next = response.ok ? videoQuota(await response.json()) : null;
        if (active) setQuotaResult({ key: quotaKey, quota: next, state: !next ? "error" : next.enabled ? "ready" : "unavailable" });
      } catch {
        if (active) setQuotaResult({ key: quotaKey, quota: null, state: "error" });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [businessId, open, quotaKey, request, videoEnabled]);

  async function next() {
    setError(null);
    if (!consented) {
      if (!mediaConsentComplete(consent, vertical)) { setError(rightsRequired); return; }
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) setQuotaResult(null); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg"
        // Opening focus goes to the first thing to do, not Close (Designer, #778 walk item 5).
        onOpenAutoFocus={(event) => { event.preventDefault(); choose.current?.focus(); }}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">{t(videoEnabled ? "upload.titleMedia" : "upload.title")}</DialogTitle>
            <DialogDescription className="text-sm text-slate-600">{t("upload.description")}</DialogDescription>
          </div>
          <DialogClose aria-label={t("upload.close")} />
        </div>
        <div className="flex flex-col gap-4 p-4">
          {videoEnabled && (
            <div className="space-y-2 text-sm text-slate-600">
              {quotaState === "ready" && quota && <>
                <p>{t("upload.videoLimits", { used: quota.used, limit: quota.limit, max: megabytes(quota.maxBytes), seconds: quota.maxSeconds })}</p>
                <p>{t("upload.videoQuotaWarning")}</p>
                <p>{t("upload.videoWholeFileRetry")}</p>
              </>}
              {quotaState === "loading" && <p role="status">{t("upload.videoQuotaLoading")}</p>}
              {quotaState === "unavailable" && <p role="alert">{t("upload.videoUnavailable")}</p>}
              {quotaState === "error" && <>
                <p role="alert">{t("upload.videoQuotaError")}</p>
                <button type="button" onClick={() => setQuotaRetries((count) => count + 1)}
                  className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-primary hover:bg-primary/5">{t("upload.tryAgain")}</button>
              </>}
            </div>
          )}
          <input ref={input} type="file" multiple accept={[...MEDIA_MIME_TYPES, ...(allowVideo ? MEDIA_VIDEO_MIME_TYPES : [])].join(",")} className="sr-only"
            aria-label={t(allowVideo ? "upload.chooseMedia" : "upload.choose")}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void uploads.pick(files, allowVideo);
            }} />
          <button ref={choose} type="button" onClick={() => input.current?.click()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <ImagePlus className="h-4 w-4" aria-hidden="true" /> {t(allowVideo ? "upload.chooseMedia" : "upload.choose")}
          </button>
          {uploads.limitNote && <p className="text-sm text-amber-800">{uploads.limitNote}</p>}
          {!consented && <MediaRightsConsent t={t} vertical={vertical} value={consent} onChange={setConsent} hasVideo={hasVideo} />}
          {consented && hasVideo && <p className="text-xs text-slate-500">{t("upload.musicNote")}</p>}
          {uploads.items.length > 0 && (
            <ul aria-label={t(videoEnabled ? "upload.picksMedia" : "upload.picks")} className="divide-y divide-slate-100">
              {uploads.items.map((item) => <ItemLine key={item.key} t={t} item={item} allowVideo={allowVideo}
                onRetry={() => void uploads.send([item])} onRemove={() => uploads.remove(item.key)} />)}
            </ul>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {progress && (
            <p role="status" className="text-sm text-slate-700">
              {progress} <span className="text-slate-500">{t("upload.keepOpen")}</span>
            </p>
          )}
          {needsTick && ready.length > 0 && <p className="text-sm text-slate-600">{rightsRequired}</p>}
          <button type="button" onClick={() => void next()} disabled={!ready.length || saving || busy || needsTick}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">
            {t(readyVideos ? readyVideos === ready.length ? "upload.addVideos" : "upload.addFiles" : videoEnabled && !ready.length ? "upload.addMedia" : "upload.add", { count: ready.length })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
