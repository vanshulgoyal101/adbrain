"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { AssetTile, downloadImage, downloadVideo, slugify } from "@/components/assets-library";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fitText, MediaUploadSheet, useMediaUploads, type MediaT } from "@/components/media-upload";
import { mediaTranslator, type Words } from "@/i18n/words";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import type { Codec, UploadDeps, VideoReader } from "@/lib/media/client-upload";
import type { MediaView } from "@/lib/media/store";
import type { BrandAsset, CreativePreview } from "@/lib/types";

const TABS = ["all", "photos", "videos", "made"] as const;
type Tab = (typeof TABS)[number];

const UNDO_MS = 6_000;

/** #778 slice 3c: one ⋯ menu (Rename · Download · Delete) on the owner's own photo (Designer, #1973 review 4). */
function OwnPhotoControls({ t, asset, request, onRenamed, onDelete }: {
  t: MediaT;
  asset: MediaView;
  request: typeof fetch;
  onRenamed: (asset: MediaView) => void;
  onDelete: (asset: MediaView) => void;
}) {
  const label = asset.name || t(asset.kind === "video" ? "library.video" : "library.photo");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await request(`/api/media/${asset.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() || null }), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => ({})) as { asset?: MediaView; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error);
      onRenamed(body.asset);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("tile.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input aria-label={t("tile.name")} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">{t("tile.save")}</button>
          <button type="button" onClick={() => { setEditing(false); setName(asset.name ?? ""); setError(null); }} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-700 hover:bg-slate-100">{t("tile.cancel")}</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }
  const url = asset.url;
  return (
    <div className="-mx-2 flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t("tile.more", { name: label })} disabled={downloading}
          className="inline-flex size-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" /> {t("tile.rename")}</DropdownMenuItem>
          {url && (
            <DropdownMenuItem onSelect={async () => {
              setError(null);
              setDownloading(true);
              try {
                const filename = `adbrain-${slugify(asset.name ?? (asset.kind === "video" ? "video" : "photo"), asset.id.slice(0, 6))}.${asset.kind === "video" ? "mp4" : "jpg"}`;
                await (asset.kind === "video" ? downloadVideo(url, filename) : downloadImage(url, filename));
              }
              catch { setError(t("tile.downloadFailed")); }
              finally { setDownloading(false); }
            }}><Download className="h-4 w-4" aria-hidden="true" /> {t("tile.download")}</DropdownMenuItem>
          )}
          <DropdownMenuItem variant="danger" onSelect={() => onDelete(asset)}><Trash2 className="h-4 w-4" aria-hidden="true" /> {t("tile.delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

const ASSET_TYPES = ["logo", "product_photo", "past_ad"] as const;
const assetType = (t: MediaT, type: string) => (ASSET_TYPES as readonly string[]).includes(type) ? t(`library.assetType.${type as (typeof ASSET_TYPES)[number]}`) : null;
const PAGE = 24;

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>;
}

/**
 * #778 slice 3a (#744 phase 1): "Photos & videos", the owner's own uploads beside the ads AdBrain made. Shown when
 * MEDIA_UPLOADS_ENABLED is on; the older Assets page stays otherwise. Words are the CPO's (#1868 on #744).
 */
export function MediaLibrary({ words, business, media: initialMedia, creatives, brandAssets, sample = false, consented = false, startOpen = false, videoEnabled = false, deps, codec, videoReader }: {
  /** The owner's language (`media`, #778 walk 1); English when none are passed. */
  words?: Words<"media">;
  business: { id: string; vertical: string | null };
  media: MediaView[];
  creatives: CreativePreview[];
  brandAssets: BrandAsset[];
  /** #1317: a prospect's sample ads have no Download, Copy link or Open; the owner's own photos keep theirs. */
  sample?: boolean;
  /** The business has confirmed the current rights terms (#784); otherwise the sheet shows the tick. */
  consented?: boolean;
  /** `/assets?add=1` (the empty state's action from elsewhere) opens the sheet. */
  startOpen?: boolean;
  videoEnabled?: boolean;
  deps?: UploadDeps;
  codec?: Codec;
  videoReader?: VideoReader;
}) {
  const t = useMemo(() => mediaTranslator(words), [words]);
  const [tab, setTab] = useState<Tab>("all");
  const [media, setMedia] = useState(initialMedia);
  const [sheetOpen, setSheetOpen] = useState(startOpen);
  const [rightsDone, setRightsDone] = useState(consented);
  const onAdded = useCallback((asset: MediaView) => setMedia((current) => [asset, ...current.filter((item) => item.id !== asset.id)]), []);
  const uploads = useMediaUploads({ t, businessId: business.id, onAdded, deps, codec, videoReader });
  const { request } = uploads;
  const onRenamed = useCallback((asset: MediaView) => setMedia((current) => current.map((item) => item.id === asset.id ? asset : item)), []);

  // #778 slice 3c: Delete hides the photo at once with "Deleted · Undo"; the delete is sent after UNDO_MS (the
  // server removes the stored file, so there's nothing to restore later). Refused (in a running ad) → it comes back.
  const [deleted, setDeleted] = useState<{ asset: MediaView; index: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restore = useCallback((asset: MediaView, index: number) => setMedia((current) => {
    const next = current.filter((item) => item.id !== asset.id);
    next.splice(Math.min(index, next.length), 0, asset);
    return next;
  }), []);
  const pending = useRef<{ asset: MediaView; index: number } | null>(null);
  const commit = useCallback(async (asset: MediaView, index: number) => {
    if (pending.current?.asset.id === asset.id) pending.current = null;
    setDeleted((current) => current?.asset.id === asset.id ? null : current);
    try {
      const response = await request(`/api/media/${asset.id}`, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
      if (response.ok) return;
      const body = await response.json().catch(() => ({})) as { error?: string };
      setDeleteError(response.status < 500 && body.error ? body.error : t("tile.deleteFailed"));
    } catch {
      setDeleteError(t("tile.deleteFailed"));
    }
    restore(asset, index);
  }, [request, restore, t]);
  const onDelete = useCallback((asset: MediaView) => {
    // A second delete sends the first one now.
    if (timer.current) clearTimeout(timer.current);
    if (deleted) void commit(deleted.asset, deleted.index);
    const index = media.findIndex((item) => item.id === asset.id);
    setDeleteError(null);
    setMedia((current) => current.filter((item) => item.id !== asset.id));
    setDeleted({ asset, index });
    pending.current = { asset, index };
    timer.current = setTimeout(() => { timer.current = null; void commit(asset, index); }, UNDO_MS);
  }, [commit, deleted, media]);
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    if (deleted) restore(deleted.asset, deleted.index);
    setDeleted(null);
  };
  // Leaving the page or the library sends a pending delete now (keepalive outlives the page) instead of dropping it.
  // `request` changes every render, so the effect reads it through a ref and runs once.
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  useEffect(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const item = pending.current;
      pending.current = null;
      if (item) void requestRef.current(`/api/media/${item.asset.id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);
  const addButton = (
    <button type="button" onClick={() => setSheetOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
      <ImagePlus className="h-4 w-4" aria-hidden="true" /> {t(videoEnabled ? "library.addMedia" : "library.add")}
    </button>
  );
  const [shown, setShown] = useState(PAGE);
  const made = creatives.filter((c) => c.image_url);
  const visibleMedia = videoEnabled ? media : media.filter((item) => item.kind === "image");
  const shownMedia = visibleMedia.filter((item) => tab === "all" || (tab === "photos" && item.kind === "image") || (tab === "videos" && item.kind === "video"));
  const shownBrandAssets = tab === "videos" ? [] : brandAssets;
  const ownCount = visibleMedia.length + brandAssets.length;

  const own = shownMedia.length + shownBrandAssets.length === 0 ? (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-6 text-sm text-slate-600">
        <p>{t(tab === "videos" ? "library.noVideos" : videoEnabled && tab === "all" ? "library.emptyMedia" : "library.empty")}</p>
        {addButton}
      </CardContent>
    </Card>
  ) : (
    <Grid>
      {shownMedia.map((m) => (
        <AssetTile key={m.id} url={m.url} kind={m.kind} title={m.name || t(m.kind === "video" ? "library.video" : "library.photo")}
          meta={(m.width && m.height) || (m.kind === "video" && m.durationMs) ? <>
            {m.width && m.height && <span className="block">{fitText(t, m.width, m.height, m.kind)}</span>}
            {m.kind === "video" && m.fit?.ratio && <span className="block">{m.fit.ratio}</span>}
            {m.kind === "video" && m.durationMs && <span className="block">{Math.floor(m.durationMs / 60_000)}:{String(Math.floor(m.durationMs / 1000) % 60).padStart(2, "0")}</span>}
          </> : undefined} actions={false}
          filename={`adbrain-${slugify(m.name ?? (m.kind === "video" ? "video" : "photo"), m.id.slice(0, 6))}.${m.kind === "video" ? "mp4" : "jpg"}`}>
          <OwnPhotoControls key={m.name ?? ""} t={t} asset={m} request={request} onRenamed={onRenamed} onDelete={onDelete} />
        </AssetTile>
      ))}
      {shownBrandAssets.map((a) => (
        <AssetTile key={a.id} url={a.url} title={a.notes || assetType(t, a.type) || t("library.assetType.other")}
          meta={a.notes ? assetType(t, a.type) ?? a.type : undefined}
          filename={`adbrain-${slugify(a.type, a.id.slice(0, 6))}.png`} />
      ))}
    </Grid>
  );

  const ads = made.length === 0 ? (
    <Card><CardContent className="py-10 text-center text-sm text-slate-500">{t("library.noAds")}</CardContent></Card>
  ) : (
    <>
      <Grid>
        {made.slice(0, shown).map((c) => (
          <AssetTile key={`${c.id}:${c.image_url}`} url={c.image_url as string} thumbnailUrl={creativeThumbnailUrl(c.image_url as string)}
            title={c.headline ?? t("library.adFallback")}
            filename={`adbrain-${slugify(c.headline ?? c.angle ?? "creative", c.id.slice(0, 6))}.jpg`}
            meta={c.status === "approved" ? <Status tone="live">{t("library.approved")}</Status> : undefined}
            actions={!sample} />
        ))}
      </Grid>
      {made.length > shown && (
        <button type="button" onClick={() => setShown((count) => count + PAGE)}
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50">
          {t("library.showMore", { n: made.length - shown })}
        </button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {ownCount > 0 && <div>{addButton}</div>}
      {/* Delete feedback lives in one bottom toast, so a scrolled owner sees why a photo came back (Designer, #2008). */}
      {(deleted || deleteError) && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col gap-2">
          {deleteError && (
            <p role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-700 py-1 pl-4 pr-1 text-sm text-white shadow-lg">
              <span className="min-w-0">{deleteError}</span>
              <button type="button" onClick={() => setDeleteError(null)} className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 font-medium hover:bg-white/10">{t("tile.ok")}</button>
            </p>
          )}
          {deleted && (
            <p role="status" className="flex items-center justify-between gap-2 rounded-lg bg-slate-900 py-1 pl-4 pr-1 text-sm text-white shadow-lg">
              <span className="min-w-0 truncate">{t("tile.deleted", { name: deleted.asset.name || t(deleted.asset.kind === "video" ? "library.video" : "library.photo") })}</span>
              <button type="button" onClick={undo} className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 font-medium text-blue-200 hover:bg-white/10">{t("tile.undo")}</button>
            </p>
          )}
        </div>
      )}
      {uploads.progress && !sheetOpen && (
        <p role="status" className="text-sm text-slate-700">{uploads.progress} <span className="text-slate-500">{t("upload.keepOpen")}</span></p>
      )}
      <MediaUploadSheet t={t} open={sheetOpen} onOpenChange={setSheetOpen} uploads={uploads} businessId={business.id} vertical={business.vertical}
        consented={rightsDone} onConsented={() => setRightsDone(true)} videoEnabled={videoEnabled} />
      <div role="tablist" aria-label={t("library.tabs.label")} className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.filter((id) => videoEnabled || id !== "videos").map((id) => (
          <button key={id} type="button" role="tab" id={`media-tab-${id}`} aria-selected={tab === id} aria-controls="media-panel"
            onClick={() => setTab(id)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${tab === id ? "border-primary text-primary" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t(`library.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="media-panel" aria-labelledby={`media-tab-${tab}`} className="flex flex-col gap-8">
        {tab !== "made" && (
          <section>
            {tab === "all" && <h2 className="mb-3 text-lg font-semibold text-slate-900">{t(videoEnabled ? "library.yoursMedia" : "library.yours")} <span className="text-sm font-normal text-slate-400">({ownCount})</span></h2>}
            {own}
          </section>
        )}
        {tab !== "photos" && tab !== "videos" && (
          <section>
            {tab === "all" && <h2 className="mb-3 text-lg font-semibold text-slate-900">{t("library.made")} <span className="text-sm font-normal text-slate-400">({made.length})</span></h2>}
            {ads}
          </section>
        )}
      </div>
    </div>
  );
}
