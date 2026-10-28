"use client";

import { CompactAppLanguage } from "@/components/app-language";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wand2 } from "lucide-react";
import { saveAdLanguage, saveSetupBusiness } from "@/app/(app)/brand/actions";
import { AdLanguageChips } from "@/components/ad-language-chips";
import { defaultAdLanguage, type CreateLanguageId } from "@/lib/languages";
import { SetupSpine, SETUP_STEPS } from "@/components/setup-spine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  SETUP_FIELDS, SETUP_FIELD_LIMITS, setupFieldErrors, setupFieldsFrom,
  type SetupBusinessFields, type SetupField,
} from "@/lib/brand/setup-fields";
import type { BrandExtraction } from "@/lib/templates/ads";
import type { Business } from "@/lib/types";
import { setupTranslator, type SetupWords } from "@/i18n/setup-words";

const AUTOSAVE_MS = 800;

/** Fields with a helper line under them (the CPO's #1251 words; text in messages `setup.business.fields`). */
const HAS_HELPER: Record<SetupField, boolean> = { name: false, vertical: false, locations: true, offer: true, phone: true };

/**
 * #1269 (#1251 WS1 step 1): a first-timer's business in five fields, saved as they type.
 * Everything else on the Brand stays on the full page ("More about your business").
 */
export function SetupBusinessStep({ business, chooseLanguage = false, words }: {
  business: Business | null;
  /** #1438: the owner's app language (Settings or the chips above); English without it. */
  words?: SetupWords;
  /** #1641: no app language chosen on this browser yet, so offer English / हिंदी above the step. */
  chooseLanguage?: boolean;
}) {
  const t = setupTranslator(words);
  const [fields, setFields] = useState<SetupBusinessFields>(() => setupFieldsFrom(business));
  const [errors, setErrors] = useState<Partial<Record<SetupField, string>>>({});
  const [adLanguage, setAdLanguage] = useState<CreateLanguageId | null>(null);
  // #1853: decided once per visit. Saving the choice sets the cookie and re-renders with chooseLanguage false;
  // the chooser stays mounted so its Hindi note can show. A reload no longer offers it.
  const [offerLanguage] = useState(chooseLanguage);
  const [saved, setSaved] = useState<"saving" | "saved" | "failed" | null>(null);
  const [website, setWebsite] = useState(business?.website ?? "");
  const [autofilling, setAutofilling] = useState(false);
  const [autofillNote, setAutofillNote] = useState<{ ok: boolean; text: string } | null>(null);
  // #1317: a shop with no website fills step 1 from a pasted Instagram bio or Google listing.
  const [pasting, setPasting] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const fieldsRef = useRef(fields);
  const idRef = useRef<string | null>(business?.id ?? null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const dirtyRef = useRef(false);
  const inputRefs = useRef<Partial<Record<SetupField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  /** Saves the latest fields once any save in flight is done; rejects when it fails. */
  function saveNow(): Promise<void> {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const run = queueRef.current.catch(() => undefined).then(async () => {
      if (!dirtyRef.current) return;
      const snapshot = fieldsRef.current;
      // A new business needs its name before the first save.
      if (!idRef.current && !snapshot.name.trim()) return;
      dirtyRef.current = false;
      setSaved("saving");
      let result: Awaited<ReturnType<typeof saveSetupBusiness>>;
      try {
        result = await saveSetupBusiness(idRef.current, snapshot);
      } catch {
        result = { ok: false, error: "offline" };
      }
      if (!result.ok) {
        dirtyRef.current = true;
        setSaved("failed");
        throw new Error(result.error);
      }
      idRef.current = result.id;
      setSaved(dirtyRef.current ? "saving" : "saved");
    });
    queueRef.current = run;
    return run;
  }

  function change(next: SetupBusinessFields) {
    fieldsRef.current = next;
    dirtyRef.current = true;
    setFields(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void saveNow().catch(() => undefined), AUTOSAVE_MS);
  }

  function set(key: SetupField, value: string) {
    change({ ...fieldsRef.current, [key]: value });
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function beforeLeave() {
    const found = setupFieldErrors(fieldsRef.current);
    const first = SETUP_FIELDS.find((key) => found[key]);
    if (first) {
      setErrors(found);
      inputRefs.current[first]?.focus();
      throw new Error("incomplete");
    }
    dirtyRef.current = true;
    await saveNow();
    // #1681: a picked ad language is saved before step 2 starts the batch; the default needs no save (step 2 works it out).
    if (adLanguage && idRef.current) await saveAdLanguage(idRef.current, adLanguage).catch(() => undefined);
  }

  async function autofill(pasted?: string) {
    setAutofillNote(null);
    if (pasted === undefined && !website.trim()) {
      setAutofillNote({ ok: false, text: t("business.needWebsite") });
      return;
    }
    setAutofilling(true);
    try {
      const res = await fetch("/api/brand/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(pasted === undefined ? { url: website } : { text: pasted }), ...(idRef.current ? { businessId: idRef.current } : {}) }),
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await res.json()) as { extraction?: BrandExtraction; error?: string };
      // The server's own words when pasted text is too short to read ("Paste a little more about the business…").
      if (pasted !== undefined && res.status === 400 && data.error) { setAutofillNote({ ok: false, text: data.error }); return; }
      if (!res.ok || !data.extraction) throw new Error("autofill");
      const found = data.extraction;
      const current = fieldsRef.current;
      // Only empty fields are filled; what the owner typed stays.
      const filled: SetupBusinessFields = {
        ...current,
        name: current.name.trim() ? current.name : found.name ?? "",
        vertical: current.vertical.trim() ? current.vertical : found.vertical ?? "",
        locations: current.locations.trim() ? current.locations : (found.locations ?? []).join("\n"),
        offer: current.offer.trim() ? current.offer : found.offers?.[0] ?? "",
        phone: current.phone.trim() ? current.phone : found.phone ?? "",
      };
      change(filled);
      setAutofillNote({ ok: true, text: pasted === undefined ? t("business.filledWebsite") : t("business.filledText") });
    } catch {
      setAutofillNote({ ok: false, text: pasted === undefined ? t("business.websiteFailed") : t("business.textFailed") });
    } finally {
      setAutofilling(false);
    }
  }

  return (
    <SetupSpine step={1} saved={saved} beforeLeave={beforeLeave} primary={{ label: t("business.primary"), href: SETUP_STEPS[1].href }} words={words}>
      {offerLanguage && <div className="mb-3 flex justify-end"><CompactAppLanguage /></div>}
      <h2 className="text-xl font-semibold text-slate-950">{t("business.title")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("business.helper")}</p>

      <div className="mt-5 flex flex-col gap-2">
        <label htmlFor="setup-website" className="text-sm font-medium text-slate-900">{t("business.website")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="setup-website" type="url" inputMode="url" placeholder="yourbusiness.com" value={website}
            onChange={(event) => setWebsite(event.target.value)} className="h-11" />
          <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => void autofill()} disabled={autofilling}>
            {autofilling ? <Spinner /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
            {t("business.fillWebsite")}
          </Button>
        </div>
        {pasting ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="setup-pasted" className="text-sm font-medium text-slate-900">{t("business.pasteLabel")}</label>
            <Textarea id="setup-pasted" rows={4} maxLength={6000} value={pastedText} onChange={(event) => setPastedText(event.target.value)}
              placeholder={t("business.pastePlaceholder")} />
            <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => void autofill(pastedText)} disabled={autofilling || !pastedText.trim()}>
              {autofilling ? <Spinner /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
              {t("business.fillText")}
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setPasting(true)} className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-blue-700 underline underline-offset-4">
            {t("business.pasteToggle")}
          </button>
        )}
        {autofillNote && <Alert variant={autofillNote.ok ? "info" : "error"}>{autofillNote.text}</Alert>}
      </div>

      <div className="mt-6 flex flex-col gap-5">
        {SETUP_FIELDS.map((key) => {
          const text = { label: t(`business.fields.${key}.label`), placeholder: t(`business.fields.${key}.placeholder`),
            helper: HAS_HELPER[key] ? t(`business.fields.${key}.helper` as "business.fields.offer.helper") : undefined };
          const id = `setup-${key}`;
          const described = [text.helper && `${id}-helper`, errors[key] && `${id}-error`].filter(Boolean).join(" ") || undefined;
          const common = {
            id, value: fields[key], placeholder: text.placeholder, maxLength: SETUP_FIELD_LIMITS[key],
            "aria-invalid": errors[key] ? true : undefined, "aria-describedby": described,
          };
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-sm font-medium text-slate-900">{text.label}</label>
              {key === "locations"
                ? <Textarea {...common} rows={2} ref={(node) => { inputRefs.current[key] = node; }}
                    onChange={(event) => set(key, event.target.value)} />
                : <Input {...common} ref={(node) => { inputRefs.current[key] = node; }} className="h-11"
                    type={key === "phone" ? "tel" : "text"} inputMode={key === "phone" ? "tel" : undefined}
                    autoComplete={key === "phone" ? "tel-national" : key === "name" ? "organization" : "off"}
                    onChange={(event) => set(key, event.target.value)} />}
              {text.helper && <p id={`${id}-helper`} className="text-xs text-slate-500">{text.helper}</p>}
              {errors[key] && <p id={`${id}-error`} className="text-sm font-medium text-red-800">{t(`business.errors.${key}`)}</p>}
            </div>
          );
        })}
      </div>

      {/* #1681 (CPO #1669): the language the first 3 ads are written in, defaulting by what they sell. */}
      <div className="mt-6"><AdLanguageChips value={adLanguage ?? defaultAdLanguage(business?.languages, fields.vertical)} onChange={setAdLanguage} /></div>
      <p className="mt-4 text-sm text-slate-600">{t("business.included")}</p>
      <Link href="/brand?all=1" onClick={() => void saveNow().catch(() => undefined)} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline underline-offset-4">
        {t("business.more")}
      </Link>
    </SetupSpine>
  );
}
