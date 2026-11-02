"use client";

import { useState } from "react";
import { Check, Download, ExternalLink, ImageIcon, Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import type { BrandAsset, CreativePreview } from "@/lib/types";
import { downloadBlob } from "@/lib/download";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";

const PAGE = 24;

const ASSET_TYPE_LABEL: Record<string, string> = {
  logo: "Logo",
  product_photo: "Product photo",
  past_ad: "Past ad",
};

async function downloadImage(url: string, filename: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error("Image download failed.");
  const blob = await res.blob();
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[blob.type.split(";")[0]];
  if (!extension || !blob.size) throw new Error("The response was not a supported image.");
  downloadBlob(blob, filename.replace(/\.[^.]+$/, `.${extension}`));
}

export function slugify(s: string, fallback: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || fallback;
}

export function AssetTile({
  url,
  thumbnailUrl,
  title,
  meta,
  filename,
  actions = true,
  children,
}: {
  /** #778: null when the private photo's signed URL couldn't be made; the tile shows a placeholder and no actions. */
  url: string | null;
  thumbnailUrl?: string;
  title: string;
  meta?: React.ReactNode;
  filename: string;
  actions?: boolean;
  /** #778: extra controls under the standard actions (own photos: Rename, Delete). */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [broken, setBroken] = useState(!url);
  const [originalFallback, setOriginalFallback] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-square bg-slate-100">
        {!broken ? (
          <img
            src={(originalFallback ? url : thumbnailUrl ?? url) ?? undefined}
            alt={title}
            loading="lazy"
            className="h-full w-full object-contain"
            onError={() => {
              if (thumbnailUrl && !originalFallback) setOriginalFallback(true);
              else setBroken(true);
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-slate-300" />
          </div>
        )}
      </div>
      <CardContent className="flex flex-col gap-1 p-3">
        <p className="truncate text-sm font-medium text-slate-800" title={title}>
          {title}
        </p>
        {meta && <div className="text-xs text-slate-500">{meta}</div>}
        {/* #847: one row of labelled 44 px icons instead of three wrapping text links. */}
        {actions && url && <div className="-mx-2 flex items-center text-slate-600">
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setError(null);
              setDownloading(true);
              try { await downloadImage(url, filename); }
              catch { setError("Download failed. Retry or use Open to view the original image."); }
              finally { setDownloading(false); }
            }}
            aria-label={downloading ? "Downloading" : "Download"}
            title="Download"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={async () => {
              setError(null);
              setCopied(false);
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { setError("Could not copy the link. Use Open to access the image."); }
            }}
            aria-label={copied ? "Copied" : "Copy link"}
            title="Copy link"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4 text-blue-700" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open"
            title="Open"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>}
        {children}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function AssetsLibrary({
  creatives,
  brandAssets,
  sample = false,
}: {
  creatives: CreativePreview[];
  brandAssets: BrandAsset[];
  /** #1317: a prospect's ads are samples: no Download, Copy link or Open on them (the owner's own uploads keep theirs). */
  sample?: boolean;
}) {
  const generated = creatives.filter((c) => c.image_url);
  // #847: 88+ full images made a 44,000 px phone page; show a page at a time.
  const [shown, setShown] = useState(PAGE);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Ads</h2>
          <span className="text-sm text-slate-400">({generated.length})</span>
        </div>
        {generated.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No ads yet. Every ad you create is saved here.
            </CardContent>
          </Card>
        ) : (
          <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {generated.slice(0, shown).map((c) => (
              <AssetTile
                key={`${c.id}:${c.image_url}`}
                url={c.image_url as string}
                thumbnailUrl={creativeThumbnailUrl(c.image_url as string)}
                title={c.headline ?? "Ad creative"}
                filename={`adbrain-${slugify(c.headline ?? c.angle ?? "creative", c.id.slice(0, 6))}.jpg`}
                meta={c.status === "approved" ? <Status tone="live">Approved</Status> : undefined}
                actions={!sample}
              />
            ))}
          </div>
          {generated.length > shown && (
            <button
              type="button"
              onClick={() => setShown((count) => count + PAGE)}
              className="mt-4 inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Show more ({generated.length - shown} left)
            </button>
          )}
          </>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Your uploads</h2>
          <span className="text-sm text-slate-400">({brandAssets.length})</span>
        </div>
        {brandAssets.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No uploads yet. Add your logo and product photos under Your business.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {brandAssets.map((a) => (
              <AssetTile
                key={a.id}
                url={a.url}
                title={a.notes || ASSET_TYPE_LABEL[a.type] || "Asset"}
                meta={a.notes ? ASSET_TYPE_LABEL[a.type] ?? a.type : undefined}
                filename={`adbrain-${slugify(a.type, a.id.slice(0, 6))}.png`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
