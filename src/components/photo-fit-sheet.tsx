"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { PhotoFit } from "@/lib/creative/fit-photo";
import { cn } from "@/lib/utils";

const PHOTO_FITS: { fit: PhotoFit; label: string }[] = [
  { fit: "attention", label: "Fill the frame" },
  { fit: "blur", label: "Show whole photo" },
];

const formatRatio = (width: number, height: number) => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
};

/** #1904: the owner sees how their photo fits the frame, and picks crop or whole photo, before anything renders. */
export function PhotoFitSheet({
  creativeId,
  photo,
  fit,
  width,
  height,
  saving,
  error,
  onFit,
  onSubmit,
  onPickAnother,
}: {
  creativeId: string;
  photo: string;
  fit: PhotoFit;
  width: number;
  height: number;
  saving: boolean;
  error: string | null;
  onFit: (fit: PhotoFit) => void;
  onSubmit: (event: React.FormEvent) => void;
  onPickAnother: () => void;
}) {
  const fitUrl = (shape: "ad" | "square") =>
    `/api/creatives/${creativeId}/photo-fit?${new URLSearchParams({ photo, fit, shape })}`;
  return (
    <form aria-label="Check how your photo fits" onSubmit={onSubmit} className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Check how your photo fits</h3>
        <p className="text-sm text-slate-600">
          {fit === "attention"
            ? "This is how it shows in Feed. Faces and the main subject are kept."
            : "This is how it shows in Feed. The whole photo, with soft edges to fill the frame."}
        </p>
      </div>
      <div className="relative mx-auto w-[260px] max-w-full overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: `${width} / ${height}` }}>
        <img key={fitUrl("ad")} src={fitUrl("ad")} alt="Your photo in the ad's frame" className="h-full w-full object-cover" />
        <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-900">
          {formatRatio(width, height)}
        </span>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
        <img key={fitUrl("square")} src={fitUrl("square")} alt="" className="size-12 rounded bg-slate-100 object-cover" />
        Square (1:1) version
      </div>
      <div role="group" aria-label="How the photo fits" className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 p-1">
        {PHOTO_FITS.map((choice) => (
          <button
            key={choice.fit}
            type="button"
            aria-pressed={fit === choice.fit}
            disabled={saving}
            onClick={() => onFit(choice.fit)}
            className={cn(
              "min-h-11 rounded-md border text-sm font-medium disabled:opacity-60",
              fit === choice.fit ? "border-primary bg-primary/10 text-primary" : "border-transparent text-slate-700 hover:bg-slate-50",
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">
        {fit === "attention" ? "Something important cut off? Show the whole photo." : "Best for group photos and wide shots."}
      </p>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={saving} className="h-11 w-full">
        {saving ? "Making it…" : "Use this photo"}
      </Button>
      <button
        type="button"
        disabled={saving}
        onClick={onPickAnother}
        className="min-h-11 text-sm font-medium text-slate-700 hover:text-slate-900 disabled:opacity-60"
      >
        Pick another photo
      </button>
    </form>
  );
}

/** #1901: the owner's own product photos, newest first. */
export function useBrandPhotos(businessId: string): string[] {
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(
      createClient()
        .from("brand_assets")
        .select("url")
        .eq("business_id", businessId)
        .eq("type", "product_photo")
        .order("created_at", { ascending: false })
        .limit(12),
    ).then(({ data }) => {
      if (alive) setPhotos((data ?? []).map((row) => row.url));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [businessId]);
  return photos;
}

export function PhotoPicker({ photos, selected, onPick }: { photos: string[]; selected: string | null; onPick: (url: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">Use another photo</legend>
      <div className="grid grid-cols-4 gap-2">
        {photos.map((url, index) => (
          <button
            key={url}
            type="button"
            aria-pressed={selected === url}
            aria-label={`Your photo ${index + 1}`}
            onClick={() => onPick(url)}
            className={cn(
              "aspect-square overflow-hidden rounded-md border-2 bg-slate-100",
              selected === url ? "border-blue-600" : "border-transparent hover:border-slate-300",
            )}
          >
            <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
