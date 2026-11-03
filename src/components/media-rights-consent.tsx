"use client";

import { mediaTranslator } from "@/i18n/words";
import { needsPeopleConsent } from "@/lib/media/consent";

export type MediaConsentValue = { rights: boolean; people: boolean };

/** Whether the owner may upload: rights ticked, and the people clause too when the vertical needs it. */
export function mediaConsentComplete(value: MediaConsentValue, vertical: string | null | undefined): boolean {
  return value.rights && (!needsPeopleConsent(vertical) || value.people);
}

/**
 * #784: the rights checkbox shown at the first upload (and again when the terms change). The upload flow
 * owns the state and sends it to `recordMediaConsent`; nothing is saved from here.
 */
export function MediaRightsConsent({ vertical, value, onChange, hasVideo = false, t = mediaTranslator() }: {
  vertical: string | null | undefined;
  value: MediaConsentValue;
  onChange: (value: MediaConsentValue) => void;
  hasVideo?: boolean;
  /** The owner's language; English (the versioned `MEDIA_*_TEXT`) when absent. */
  t?: ReturnType<typeof mediaTranslator>;
}) {
  const people = needsPeopleConsent(vertical);
  return (
    <fieldset className="grid gap-2 text-sm text-slate-800">
      <legend className="sr-only">{t("upload.rightsLegend")}</legend>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" className="mt-1 accent-blue-600" checked={value.rights} onChange={(event) => onChange({ ...value, rights: event.target.checked })} />
        <span>{t("upload.rightsText")}</span>
      </label>
      {people && (
        <label className="flex min-h-11 items-start gap-2">
          <input type="checkbox" className="mt-1 accent-blue-600" checked={value.people} onChange={(event) => onChange({ ...value, people: event.target.checked })} />
          <span>{t("upload.peopleText")}</span>
        </label>
      )}
      {hasVideo && <p className="text-xs text-slate-500">{t("upload.musicNote")}</p>}
    </fieldset>
  );
}
