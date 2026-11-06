"use client";

import { useState, type ReactNode } from "react";
import { AdAssistant } from "@/components/ad-assistant";
import { PickedPhotos } from "@/components/picked-photos";
import type { MediaView } from "@/lib/media/store";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import { Stepper, type AdFlowStep } from "@/components/ui/stepper";
import type { Suggestion } from "@/lib/seasonal";
import type { Business } from "@/lib/types";
import { createAdsTranslator, type Words } from "@/i18n/words";

/** The Create page's stepper follows the assistant (#760): Brief while the owner answers, Create once ads are made. */
export function CreateFlow({ business, opening, occasions, words, photos: picked = [], children }: {
  business: Business; opening: OpeningLine | null; occasions?: Suggestion[]; words?: Words<"create">;
  /** #780 slice 2a: library media sent here with `?photos=`; only images enter this photo-only flow. */
  photos?: MediaView[];
  children: ReactNode;
}) {
  const [step, setStep] = useState<AdFlowStep>("Brief");
  const [photos, setPhotos] = useState(() => picked.filter((photo) => photo.kind === "image"));
  const hasUnsupportedVideos = picked.some((photo) => photo.kind === "video");
  const t = createAdsTranslator(words);
  return (
    <>
      <Stepper current={step} className="mt-4" labels={words?.messages} lang={words && words.locale !== "en" ? words.locale : undefined} />
      <div className="mt-6 flex flex-col gap-8 border-t border-slate-200 pt-6">
        <PickedPhotos photos={photos} words={words} onRemove={step === "Brief" ? (id) => setPhotos((current) => current.filter((photo) => photo.id !== id)) : undefined} />
        {hasUnsupportedVideos && <p role="status" lang={words && words.locale !== "en" ? words.locale : undefined} className="max-w-2xl text-sm text-amber-800">{t("videosNotSupported")}</p>}
        <AdAssistant business={business} opening={opening} occasions={occasions} onFlowStep={setStep} words={words} mediaIds={photos.map((photo) => photo.id)} />
        {children}
      </div>
    </>
  );
}
