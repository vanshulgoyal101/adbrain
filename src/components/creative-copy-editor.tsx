"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { LivePicture, type PicturePreview } from "@/components/live-picture";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { updateCreativeCopy, type CopyEditResult } from "@/app/(app)/studio/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { editableCopySchema, savedCreativeDescription, type EditableCopy } from "@/lib/creative/concept";
import { pictureDesign, pictureWordsOf, pictureWordsSchema, withPictureWords, type PictureWords } from "@/lib/creative/picture-words";
import { createClient } from "@/lib/supabase/client";
import { META_CTAS, type BrandContext } from "@/lib/templates/ads";
import type { Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMITS = {
  headline: editableCopySchema.shape.headline.maxLength ?? 40,
  primary_text: editableCopySchema.shape.primary_text.maxLength ?? 900,
  description: editableCopySchema.shape.description.maxLength ?? 100,
};

export type CopyEditNotes = Pick<CopyEditResult, "warnings" | "liveNotice">;

/** The text an ad shows: saved, or the owner's unsaved draft while editing (#387). */
export type AdText = { headline: string; primary_text: string; description: string; cta: string };

export function savedAdText(creative: Creative): AdText {
  return {
    headline: creative.headline ?? "",
    primary_text: creative.primary_text ?? "",
    description: savedCreativeDescription(creative.generation) ?? "",
    cta: creative.cta ?? "",
  };
}

export function sameAdText(a: AdText, b: AdText): boolean {
  return a.headline === b.headline && a.primary_text === b.primary_text && a.description === b.description && a.cta === b.cta;
}

/** The ad's stored background photo, when its receipt has one (ads made since #315). */
function savedPhotoUrl(creative: Creative): string | null {
  const generation = creative.generation as { photoUrl?: unknown } | null;
  return typeof generation?.photoUrl === "string" ? generation.photoUrl : null;
}

const PREVIEW_DEBOUNCE_MS = 700;

/** Marks a live preview that isn't saved yet, so nobody mistakes it for the saved ad. */
export function UnsavedPreviewBadge() {
  return (
    <span role="status" className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      Preview · unsaved changes
    </span>
  );
}

/** Inline editor for an ad's words (#280). Saving never calls the AI. */
function CreativeCopyEditor({
  creative,
  onSaved,
  onCancel,
  onBusy,
  onDraft,
}: {
  creative: Creative;
  onSaved: (creative: Creative, notes: CopyEditNotes) => void;
  onCancel: () => void;
  onBusy?: (busy: boolean) => void;
  /** Called with every edit so the card can preview it live; null when the editor closes. */
  onDraft?: (copy: AdText | null) => void;
}) {
  const [copy, setCopy] = useState<EditableCopy>(() => ({
    headline: creative.headline ?? "",
    primary_text: creative.primary_text ?? "",
    description: savedCreativeDescription(creative.generation) ?? "",
    cta: (META_CTAS as readonly string[]).includes(creative.cta ?? "")
      ? (creative.cta as EditableCopy["cta"])
      : META_CTAS[0],
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  useEffect(() => onBusy?.(saving), [saving, onBusy]);
  useEffect(() => onDraft?.(copy), [copy, onDraft]);
  useEffect(() => () => onDraft?.(null), [onDraft]);
  const field = (key: keyof EditableCopy) => `copy-${creative.id}-${key}`;
  const set = <K extends keyof EditableCopy>(key: K, value: EditableCopy[K]) =>
    setCopy((current) => ({ ...current, [key]: value }));

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      try {
        const res = await updateCreativeCopy(creative.id, copy);
        if (res.ok && res.creative) {
          onSaved({ ...creative, ...res.creative }, { warnings: res.warnings ?? [], liveNotice: res.liveNotice });
        } else setError(res.error ?? "Couldn't save your changes. Try again.");
      } catch {
        setError("Couldn't save your changes. Check your connection and try again.");
      }
    });
  }

  const counter = (key: keyof typeof LIMITS) => (
    <span className="text-xs tabular-nums text-slate-400">
      {copy[key].length}/{LIMITS[key]}
    </span>
  );

  return (
    <form aria-label="Edit ad text" onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={field("headline")}>Headline</Label>
          {counter("headline")}
        </div>
        <Input
          id={field("headline")}
          value={copy.headline}
          maxLength={LIMITS.headline}
          onChange={(e) => set("headline", e.target.value)}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={field("primary_text")}>Main text</Label>
          {counter("primary_text")}
        </div>
        <Textarea
          id={field("primary_text")}
          value={copy.primary_text}
          maxLength={LIMITS.primary_text}
          rows={5}
          onChange={(e) => set("primary_text", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={field("description")}>Description</Label>
          {counter("description")}
        </div>
        <Input
          id={field("description")}
          value={copy.description}
          maxLength={LIMITS.description}
          placeholder="Optional line under the headline"
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("cta")}>Button</Label>
        <Select
          id={field("cta")}
          value={copy.cta}
          onChange={(e) => set("cta", e.target.value as EditableCopy["cta"])}
        >
          {META_CTAS.map((cta) => (
            <option key={cta} value={cta}>
              {cta}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        This changes the text shown with your ad. Words printed on the picture stay as they are.
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving} className="h-11 flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={saving}
          className="h-11 flex-1"
        >
          Save
        </Button>
      </div>
    </form>
  );
}

/** What the owner should know after saving: unbacked claims and live campaigns. */
export function CopyEditNotice({ notes }: { notes: CopyEditNotes }) {
  const warnings = notes.warnings ?? [];
  return (
    <div className="flex flex-col gap-1.5" role="status">
      {warnings.length === 0 && !notes.liveNotice && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved.
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
        </p>
      ))}
      {notes.liveNotice && (
        <p className="flex items-start gap-1.5 text-xs text-slate-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notes.liveNotice}
        </p>
      )}
    </div>
  );
}

const PICTURE_LIMITS = {
  headline: pictureWordsSchema.shape.headline.maxLength ?? 40,
  subhead: pictureWordsSchema.shape.subhead.maxLength ?? 64,
  phone: pictureWordsSchema.shape.phone.maxLength ?? 20,
};

/** Redraws the words printed on the picture over the same background (#280). No AI. */
function PictureWordsEditor({
  creative,
  brand,
  onSaved,
  onCancel,
  onBusy,
  onPreview,
}: {
  creative: Creative;
  brand: BrandContext;
  onSaved: (creative: Creative, notes: CopyEditNotes) => void;
  onCancel: () => void;
  onBusy?: (busy: boolean) => void;
  /** Live picture with the unsaved words (#387); null when there's nothing to preview. */
  onPreview?: (preview: PicturePreview | null) => void;
}) {
  // Keyed on the fields the overlay uses: some cards rebuild `creative` on every render.
  const { id, headline, primary_text, cta, angle, generation } = creative;
  const base = useMemo(
    () => pictureDesign({ headline, primary_text, cta, angle, generation }, brand),
    [headline, primary_text, cta, angle, generation, brand],
  );
  const photoUrl = savedPhotoUrl(creative);
  const [initial] = useState(() => pictureWordsOf(base));
  const [words, setWords] = useState<PictureWords>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => onBusy?.(saving), [saving, onBusy]);
  useEffect(() => {
    if (!onPreview) return;
    if (JSON.stringify(words) === JSON.stringify(initial) || !pictureWordsSchema.safeParse(words).success) {
      onPreview(null);
      return;
    }
    const spec = { ...withPictureWords(base, words), backgroundUrl: photoUrl };
    onPreview({ spec });
    // Then swap in the exact server render (fonts, Indic shaping), once typing pauses.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/creatives/${id}/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...words, preview: true }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { previewUrl?: string };
        if (res.ok && data.previewUrl && !controller.signal.aborted) onPreview({ spec, renderedUrl: data.previewUrl });
      } catch {
        // The instant preview stays; Save still renders the real picture.
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [words, initial, base, id, photoUrl, onPreview]);
  useEffect(() => () => onPreview?.(null), [onPreview]);
  const field = (key: keyof PictureWords) => `picture-${creative.id}-${key}`;
  const set = <K extends keyof PictureWords>(key: K, value: PictureWords[K]) =>
    setWords((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/creatives/${creative.id}/picture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(words),
      });
      const data = (await res.json().catch(() => ({}))) as { creative?: Creative; liveNotice?: string; error?: string };
      if (res.ok && data.creative) onSaved({ ...creative, ...data.creative }, { warnings: [], liveNotice: data.liveNotice });
      else setError(data.error ?? "Couldn't redraw the picture. Try again.");
    } catch {
      setError("Couldn't redraw the picture. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const counter = (key: keyof typeof PICTURE_LIMITS) => (
    <span className="text-xs tabular-nums text-slate-400">
      {words[key].length}/{PICTURE_LIMITS[key]}
    </span>
  );

  return (
    <form aria-label="Edit words on the picture" onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={field("headline")}>Headline on picture</Label>
          {counter("headline")}
        </div>
        <Input id={field("headline")} value={words.headline} maxLength={PICTURE_LIMITS.headline} onChange={(e) => set("headline", e.target.value)} autoFocus />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={field("subhead")}>Offer line</Label>
          {counter("subhead")}
        </div>
        <Input id={field("subhead")} value={words.subhead} maxLength={PICTURE_LIMITS.subhead} placeholder="Optional, e.g. Free site visit this week" onChange={(e) => set("subhead", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("phone")}>Phone</Label>
        <Input id={field("phone")} type="tel" inputMode="tel" value={words.phone} maxLength={PICTURE_LIMITS.phone} placeholder="Optional" onChange={(e) => set("phone", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("ctaLabel")}>Button on picture</Label>
        <Select
          id={field("ctaLabel")}
          value={words.showCta ? words.ctaLabel : ""}
          onChange={(e) =>
            setWords((w) =>
              e.target.value ? { ...w, showCta: true, ctaLabel: e.target.value as PictureWords["ctaLabel"] } : { ...w, showCta: false },
            )
          }
        >
          <option value="">No button (Meta adds a real one below the ad)</option>
          {META_CTAS.map((cta) => (
            <option key={cta} value={cta}>
              {cta}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Redraws only the words on the picture, on the same background. No AI and no cost.
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving} className="h-11 flex-1">
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={saving} className="h-11 flex-1">
          {saving ? "Redrawing…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** A new picture behind the same words (#280 slice 3). One paid AI image, like Regenerate. */
function BackgroundEditor({
  creative,
  brand,
  onSaved,
  onCancel,
  onBusy,
  onPreview,
}: {
  creative: Creative;
  brand: BrandContext;
  onSaved: (creative: Creative, notes: CopyEditNotes) => void;
  onCancel: () => void;
  onBusy?: (busy: boolean) => void;
  onPreview?: (preview: PicturePreview | null) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  // A picked photo shows behind the same words at once (#387).
  const { headline, primary_text, cta, angle, generation } = creative;
  const base = useMemo(
    () => pictureDesign({ headline, primary_text, cta, angle, generation }, brand),
    [headline, primary_text, cta, angle, generation, brand],
  );
  useEffect(() => {
    onPreview?.(photo ? { spec: { ...base, backgroundUrl: photo } } : null);
  }, [photo, base, onPreview]);
  useEffect(() => () => onPreview?.(null), [onPreview]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => onBusy?.(saving), [saving, onBusy]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(
      createClient()
        .from("brand_assets")
        .select("url")
        .eq("business_id", creative.business_id)
        .eq("type", "product_photo")
        .order("created_at", { ascending: false })
        .limit(12),
    ).then(({ data }) => {
      if (alive) setPhotos((data ?? []).map((row) => row.url));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [creative.business_id]);
  const id = `background-${creative.id}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/creatives/${creative.id}/background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(photo ? { photoUrl: photo } : { instruction }),
      });
      const data = (await res.json().catch(() => ({}))) as { creative?: Creative; liveNotice?: string; error?: string };
      if (res.ok && data.creative) onSaved({ ...creative, ...data.creative }, { warnings: [], liveNotice: data.liveNotice });
      else setError(data.error ?? "Couldn't make a new background. Try again.");
    } catch {
      setError("Couldn't make a new background. Check your connection, then refresh before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label="Change the picture" onSubmit={save} className="flex flex-col gap-3">
      {/* #1901: the owner's photos first, then an AI picture; neither changes the words. */}
      {photos.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Use another photo</legend>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((url, index) => (
              <button
                key={url}
                type="button"
                aria-pressed={photo === url}
                aria-label={`Your photo ${index + 1}`}
                onClick={() => setPhoto((current) => (current === url ? null : url))}
                className={cn(
                  "aspect-square overflow-hidden rounded-md border-2 bg-slate-100",
                  photo === url ? "border-blue-600" : "border-transparent hover:border-slate-300",
                )}
              >
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>Or describe an AI picture</Label>
          <span className="text-xs tabular-nums text-slate-400">{instruction.length}/300</span>
        </div>
        <Textarea
          id={id}
          value={instruction}
          maxLength={300}
          rows={3}
          placeholder="e.g. Rooftop at sunset with solar panels"
          onChange={(e) => {
            setInstruction(e.target.value);
            setPhoto(null);
          }}
        />
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {photo
          ? "Puts your photo behind the same words. Your text and the words on the picture stay. No AI and no cost."
          : "Makes a new picture behind the same words. Your text and the words on the picture stay. This uses one AI image, like Regenerate, and takes up to a minute."}
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving} className="h-11 flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={saving || (!photo && instruction.trim().length < 3)}
          className="h-11 flex-1"
        >
          {saving ? "Making it…" : photo ? "Use this photo" : "Make background"}
        </Button>
      </div>
    </form>
  );
}

/** One Edit entry point with a tab per part of the ad. */
export function CreativeEditor({
  creative,
  brand,
  onSaved,
  onCancel,
  onDraft,
  onPicturePreview,
}: {
  creative: Creative;
  brand: BrandContext;
  onSaved: (creative: Creative, notes: CopyEditNotes) => void;
  onCancel: () => void;
  onDraft?: (copy: AdText | null) => void;
  onPicturePreview?: (preview: PicturePreview | null) => void;
}) {
  const [tab, setTab] = useState<"text" | "picture" | "background">("text");
  // On a phone the card's picture scrolls away while typing; keep a small copy in view (#387).
  const [mini, setMini] = useState<PicturePreview | null>(null);
  const picturePreview = useCallback((preview: PicturePreview | null) => {
    setMini(preview);
    onPicturePreview?.(preview);
  }, [onPicturePreview]);
  // Switching tabs mid-save would unmount the editor whose request is still running.
  const [busy, setBusy] = useState(false);
  const tabs = [
    ["text", "Ad text"],
    ["picture", "Words on picture"],
    ["background", "Background"],
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="What to edit" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            disabled={busy}
            onClick={() => setTab(id)}
            className={cn(
              "min-h-9 rounded-md px-1 py-1 text-xs font-medium leading-tight transition-colors disabled:opacity-60 sm:text-sm",
              tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mini && tab !== "text" && (
        <div
          data-testid="phone-picture-preview"
          className="sticky top-16 z-10 mx-auto w-36 overflow-hidden rounded-md bg-slate-100 shadow-md ring-1 ring-slate-200 sm:hidden"
          style={{ aspectRatio: `${mini.spec.width} / ${mini.spec.height}` }}
        >
          <LivePicture preview={mini} />
        </div>
      )}
      {tab === "text" ? (
        <CreativeCopyEditor creative={creative} onSaved={onSaved} onCancel={onCancel} onBusy={setBusy} onDraft={onDraft} />
      ) : tab === "picture" ? (
        <PictureWordsEditor creative={creative} brand={brand} onSaved={onSaved} onCancel={onCancel} onBusy={setBusy} onPreview={picturePreview} />
      ) : (
        <BackgroundEditor creative={creative} brand={brand} onSaved={onSaved} onCancel={onCancel} onBusy={setBusy} onPreview={picturePreview} />
      )}
    </div>
  );
}
