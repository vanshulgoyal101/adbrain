"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { AssetTile, slugify } from "@/components/assets-library";
import { MediaUploadSheet, useMediaUploads } from "@/components/media-upload";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import type { Codec, UploadDeps } from "@/lib/media/client-upload";
import type { MediaView } from "@/lib/media/store";
import type { BrandAsset, CreativePreview } from "@/lib/types";

const TABS = [
  { id: "all", label: "All" },
  { id: "photos", label: "Photos" },
  // CPO #1868 lists Videos too; it appears when video uploads ship (#744 phase 2).
  { id: "made", label: "Made by AdBrain" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const UNDO_MS = 6_000;
const iconButton = "inline-flex size-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50";

/** #778 slice 3c: Rename and Delete on the owner's own photo. */
function OwnPhotoControls({ asset, request, onRenamed, onDelete }: {
  asset: MediaView;
  request: typeof fetch;
  onRenamed: (asset: MediaView) => void;
  onDelete: (asset: MediaView) => void;
}) {
  const label = asset.name || "Photo";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(caught instanceof Error && caught.message ? caught.message : "Couldn't save the change. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input aria-label="Name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-50">Save</button>
          <button type="button" onClick={() => { setEditing(false); setName(asset.name ?? ""); setError(null); }} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }
  return (
    <div className="-mx-2 flex items-center">
      <button type="button" aria-label={`Rename ${label}`} title="Rename" className={iconButton} onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Delete ${label}`} title="Delete" className={iconButton} onClick={() => onDelete(asset)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const ASSET_TYPE_LABEL: Record<string, string> = { logo: "Logo", product_photo: "Product photo", past_ad: "Past ad" };
const PAGE = 24;

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>;
}

/**
 * #778 slice 3a (#744 phase 1): "Photos & videos", the owner's own uploads beside the ads AdBrain made. Shown when
 * MEDIA_UPLOADS_ENABLED is on; the older Assets page stays otherwise. Words are the CPO's (#1868 on #744).
 */
export function MediaLibrary({ business, media: initialMedia, creatives, brandAssets, sample = false, consented = false, startOpen = false, deps, codec }: {
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
  deps?: UploadDeps;
  codec?: Codec;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [media, setMedia] = useState(initialMedia);
  const [sheetOpen, setSheetOpen] = useState(startOpen);
  const [rightsDone, setRightsDone] = useState(consented);
  const onAdded = useCallback((asset: MediaView) => setMedia((current) => [asset, ...current.filter((item) => item.id !== asset.id)]), []);
  const uploads = useMediaUploads({ businessId: business.id, onAdded, deps, codec });
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
  const commit = useCallback(async (asset: MediaView, index: number) => {
    setDeleted((current) => current?.asset.id === asset.id ? null : current);
    try {
      const response = await request(`/api/media/${asset.id}`, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
      if (response.ok) return;
      const body = await response.json().catch(() => ({})) as { error?: string };
      setDeleteError(response.status < 500 && body.error ? body.error : "Couldn't delete the photo. Try again.");
    } catch {
      setDeleteError("Couldn't delete the photo. Try again.");
    }
    restore(asset, index);
  }, [request, restore]);
  const onDelete = useCallback((asset: MediaView) => {
    // A second delete sends the first one now.
    if (timer.current) clearTimeout(timer.current);
    if (deleted) void commit(deleted.asset, deleted.index);
    const index = media.findIndex((item) => item.id === asset.id);
    setDeleteError(null);
    setMedia((current) => current.filter((item) => item.id !== asset.id));
    setDeleted({ asset, index });
    timer.current = setTimeout(() => { timer.current = null; void commit(asset, index); }, UNDO_MS);
  }, [commit, deleted, media]);
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (deleted) restore(deleted.asset, deleted.index);
    setDeleted(null);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const addButton = (
    <button type="button" onClick={() => setSheetOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
      <ImagePlus className="h-4 w-4" aria-hidden="true" /> Add photos & videos
    </button>
  );
  const [shown, setShown] = useState(PAGE);
  const made = creatives.filter((c) => c.image_url);
  const ownCount = media.length + brandAssets.length;

  const own = ownCount === 0 ? (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-6 text-sm text-slate-600">
        <p>No photos or videos yet. Add your own work: finished jobs, your shop, your team.</p>
        {addButton}
      </CardContent>
    </Card>
  ) : (
    <Grid>
      {media.map((m) => (
        <AssetTile key={m.id} url={m.url} title={m.name || "Photo"} meta={m.fit?.message}
          filename={`adbrain-${slugify(m.name ?? "photo", m.id.slice(0, 6))}.jpg`}>
          <OwnPhotoControls key={m.name ?? ""} asset={m} request={request} onRenamed={onRenamed} onDelete={onDelete} />
        </AssetTile>
      ))}
      {brandAssets.map((a) => (
        <AssetTile key={a.id} url={a.url} title={a.notes || ASSET_TYPE_LABEL[a.type] || "Asset"}
          meta={a.notes ? ASSET_TYPE_LABEL[a.type] ?? a.type : undefined}
          filename={`adbrain-${slugify(a.type, a.id.slice(0, 6))}.png`} />
      ))}
    </Grid>
  );

  const ads = made.length === 0 ? (
    <Card><CardContent className="py-10 text-center text-sm text-slate-500">No ads yet. Every ad you create is saved here.</CardContent></Card>
  ) : (
    <>
      <Grid>
        {made.slice(0, shown).map((c) => (
          <AssetTile key={`${c.id}:${c.image_url}`} url={c.image_url as string} thumbnailUrl={creativeThumbnailUrl(c.image_url as string)}
            title={c.headline ?? "Ad creative"}
            filename={`adbrain-${slugify(c.headline ?? c.angle ?? "creative", c.id.slice(0, 6))}.jpg`}
            meta={c.status === "approved" ? <Status tone="live">Approved</Status> : undefined}
            actions={!sample} />
        ))}
      </Grid>
      {made.length > shown && (
        <button type="button" onClick={() => setShown((count) => count + PAGE)}
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Show more ({made.length - shown} left)
        </button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {ownCount > 0 && <div>{addButton}</div>}
      {deleted && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
          Deleted
          <button type="button" onClick={undo} className="inline-flex min-h-11 items-center rounded-md px-3 font-medium text-blue-700 hover:bg-blue-50">Undo</button>
        </p>
      )}
      {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
      {uploads.progress && !sheetOpen && (
        <p role="status" className="text-sm text-slate-700">{uploads.progress} <span className="text-slate-500">You can keep going; uploads finish in the background.</span></p>
      )}
      <MediaUploadSheet open={sheetOpen} onOpenChange={setSheetOpen} uploads={uploads} businessId={business.id} vertical={business.vertical}
        consented={rightsDone} onConsented={() => setRightsDone(true)} />
      <div role="tablist" aria-label="Show" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`media-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="media-panel"
            onClick={() => setTab(t.id)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="media-panel" aria-labelledby={`media-tab-${tab}`} className="flex flex-col gap-8">
        {tab !== "made" && (
          <section>
            {tab === "all" && <h2 className="mb-3 text-lg font-semibold text-slate-900">Your photos <span className="text-sm font-normal text-slate-400">({ownCount})</span></h2>}
            {own}
          </section>
        )}
        {tab !== "photos" && (
          <section>
            {tab === "all" && <h2 className="mb-3 text-lg font-semibold text-slate-900">Made by AdBrain <span className="text-sm font-normal text-slate-400">({made.length})</span></h2>}
            {ads}
          </section>
        )}
      </div>
    </div>
  );
}
