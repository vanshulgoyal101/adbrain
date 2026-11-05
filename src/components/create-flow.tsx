"use client";

import { useState, type ReactNode } from "react";
import { AdAssistant } from "@/components/ad-assistant";
import { OwnWordsForm, type PhotoPickWords } from "@/components/own-words-form";
import { PickedPhotos } from "@/components/picked-photos";
import type { MediaView } from "@/lib/media/store";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import { Stepper, type AdFlowStep } from "@/components/ui/stepper";
import type { Suggestion } from "@/lib/seasonal";
import type { Business } from "@/lib/types";
import type { Words } from "@/i18n/words";

/** The Create page's stepper follows the assistant (#760): Brief while the owner answers, Create once ads are made. */
export function CreateFlow({ business, opening, occasions, words, photoPickWords, overlayAvailable, media: initialMedia, photos: legacyPhotos = [], children }: {
  business: Business; opening: OpeningLine | null; occasions?: Suggestion[]; words?: Words<"create">;
  photoPickWords?: PhotoPickWords;
  overlayAvailable?: boolean;
  /** #780: library media sent here with `?media=`, each one ad's picture. */
  media?: MediaView[];
  /** Older links used `?photos=` before videos were available. */
  photos?: MediaView[];
  children: ReactNode;
}) {
  const [step, setStep] = useState<AdFlowStep>("Brief");
  const [photos, setPhotos] = useState(initialMedia ?? legacyPhotos);
  const [own, setOwn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = step === "Brief" && !saved && !saving;
  const hasVideo = photos.some((photo) => photo.kind === "video");
  const ownMode = own || hasVideo;
  return (
    <>
      <Stepper current={step} className="mt-4" labels={words?.messages} lang={words && words.locale !== "en" ? words.locale : undefined} />
      <div className="mt-6 flex flex-col gap-8 border-t border-slate-200 pt-6">
        <PickedPhotos photos={photos} words={words} own={ownMode} onOwn={editable && !hasVideo ? setOwn : undefined}
          onRemove={editable && photos.length > (ownMode ? 1 : 0) ? (id) => setPhotos((current) => current.filter((photo) => photo.id !== id)) : undefined} />
        {ownMode && photos.length
          ? <OwnWordsForm businessId={business.id} photos={photos} words={words} photoPickWords={photoPickWords} overlayAvailable={overlayAvailable} onSaving={setSaving} onSaved={() => { setSaved(true); setStep("Create"); }} />
          : <AdAssistant business={business} opening={opening} occasions={occasions} onFlowStep={setStep} words={words} mediaIds={photos.map((photo) => photo.id)} />}
        {children}
      </div>
    </>
  );
}
