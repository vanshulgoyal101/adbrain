"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { updateCreativeCopy, type CopyEditResult } from "@/app/(app)/studio/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { editableCopySchema, savedCreativeDescription, type EditableCopy } from "@/lib/creative/concept";
import { META_CTAS } from "@/lib/templates/ads";
import type { Creative } from "@/lib/types";

const LIMITS = {
  headline: editableCopySchema.shape.headline.maxLength ?? 40,
  primary_text: editableCopySchema.shape.primary_text.maxLength ?? 900,
  description: editableCopySchema.shape.description.maxLength ?? 100,
};

export type CopyEditNotes = Pick<CopyEditResult, "warnings" | "liveNotice">;

/** Inline editor for an ad's words (#280). Saving never calls the AI. */
export function CreativeCopyEditor({
  creative,
  onSaved,
  onCancel,
}: {
  creative: Creative;
  onSaved: (creative: Creative, notes: CopyEditNotes) => void;
  onCancel: () => void;
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
