"use client";

import { X } from "lucide-react";
import { createAdsTranslator, type Words } from "@/i18n/words";
import type { MediaView } from "@/lib/media/store";

/** #780 slice 2a: the library photos this Create uses, one per ad; removable until the ads are being made. */
export function PickedPhotos({ photos, onRemove, words }: { photos: MediaView[]; onRemove?: (id: string) => void; words?: Words<"create"> }) {
  const t = createAdsTranslator(words), lang = words && words.locale !== "en" ? words.locale : undefined;
  if (!photos.length) return null;
  return (
    <section aria-labelledby="picked-photos" lang={lang} className="max-w-2xl">
      <h2 id="picked-photos" className="text-sm font-semibold text-slate-900">{t("yourPhotos", { n: photos.length })}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("photosNote")}</p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {photos.map((photo, index) => (
          <li key={photo.id} className="relative size-24 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
            {photo.url && <img src={photo.url} alt={photo.name ?? ""} className="h-full w-full object-cover" />}
            {onRemove && (
              <button type="button" onClick={() => onRemove(photo.id)} aria-label={t("removePhoto", { n: index + 1 })}
                className="absolute right-0 top-0 inline-flex size-11 items-start justify-end p-1">
                <X className="size-6 rounded-full bg-slate-900/70 p-1 text-white" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
