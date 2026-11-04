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
export function CreateFlow({ business, opening, occasions, words, photoPickWords, overlayAvailable, photos: picked = [], children }: {
  business: Business; opening: OpeningLine | null; occasions?: Suggestion[]; words?: Words<"create">;
  photoPickWords?: PhotoPickWords;
  overlayAvailable?: boolean;
  /** #780 slice 2a: library photos sent here with `?photos=`, each one ad's picture. */
  photos?: MediaView[];
  children: ReactNode;
}) {
  const [step, setStep] = useState<AdFlowStep>("Brief");
  const [photos, setPhotos] = useState(picked);
  const [own, setOwn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = step === "Brief" && !saved && !saving;
  return (
    <>
      <Stepper current={step} className="mt-4" labels={words?.messages} lang={words && words.locale !== "en" ? words.locale : undefined} />
      <div className="mt-6 flex flex-col gap-8 border-t border-slate-200 pt-6">
        <PickedPhotos photos={photos} words={words} own={own} onOwn={editable ? setOwn : undefined}
          onRemove={editable && photos.length > (own ? 1 : 0) ? (id) => setPhotos((current) => current.filter((photo) => photo.id !== id)) : undefined} />
        {own && photos.length
          ? <OwnWordsForm businessId={business.id} photos={photos} words={words} photoPickWords={photoPickWords} overlayAvailable={overlayAvailable} onSaving={setSaving} onSaved={() => { setSaved(true); setStep("Create"); }} />
          : <AdAssistant business={business} opening={opening} occasions={occasions} onFlowStep={setStep} words={words} mediaIds={photos.map((photo) => photo.id)} />}
        {children}
      </div>
    </>
  );
}
