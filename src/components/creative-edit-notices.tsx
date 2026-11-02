"use client";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { CopyEditNotes } from "@/components/creative-copy-editor";

/** Marks a live preview that isn't saved yet, so nobody mistakes it for the saved ad. */
export function UnsavedPreviewBadge() {
  return (
    <span role="status" className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      Preview · unsaved changes
    </span>
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
