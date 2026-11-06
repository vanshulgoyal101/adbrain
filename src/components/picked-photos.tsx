"use client";

import { X } from "lucide-react";
import { createAdsTranslator, type Words } from "@/i18n/words";
import type { MediaView } from "@/lib/media/store";

/** #780 slice 2a: the library photos this Create uses, one per ad; removable until the ads are being made. */
export function PickedPhotos({ photos, onRemove, words, own = false, onOwn }: {
  photos: MediaView[]; onRemove?: (id: string) => void; words?: Words<"create">;
  /** #780 slice 2b: the owner writes each ad's words himself; `onOwn` is unset once the words are being made or saved. */
  own?: boolean; onOwn?: (own: boolean) => void;
}) {
  const t = createAdsTranslator(words), lang = words && words.locale !== "en" ? words.locale : undefined;
  if (!photos.length) return null;
  const hasVideo = photos.some((photo) => photo.kind === "video");
  return (
    <section aria-labelledby="picked-photos" lang={lang} className="max-w-2xl">
      <h2 id="picked-photos" className="text-sm font-semibold text-slate-900">{t(hasVideo ? "yourMedia" : "yourPhotos", { n: photos.length })}</h2>
      {!hasVideo && <div role="radiogroup" aria-label={t("wordsChoice")} className="mt-2 inline-grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
        {([[false, "wordsForMe"], [true, "wordsMine"]] as const).map(([value, key]) => (
          <button key={key} type="button" role="radio" aria-checked={own === value} disabled={!onOwn} onClick={() => onOwn?.(value)}
            className={`min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-60 ${own === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {t(key)}
          </button>
        ))}
      </div>}
      <p className="mt-2 text-sm text-slate-600">{t(hasVideo ? "mediaNote" : own ? "ownNote" : "photosNote")}</p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {photos.map((photo, index) => (
          <li key={photo.id} className="relative size-24 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
            {photo.kind === "video"
              ? <video aria-hidden="true" src={photo.url ?? undefined} muted playsInline className="h-full w-full object-cover" />
              : photo.url && <img src={photo.url} alt={photo.name ?? ""} className="h-full w-full object-cover" />}
            {onRemove && (
              <button type="button" onClick={() => onRemove(photo.id)} aria-label={t(photo.kind === "video" ? "removeVideo" : "removePhoto", { n: index + 1 })}
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
