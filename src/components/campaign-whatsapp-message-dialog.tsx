"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { saveWhatsAppTemplate } from "@/app/(app)/brand/whatsapp-template-actions";
import { whatsappTemplateSchema, type WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import { DraftPreview, WhatsAppMessageFields, draftFromSuggestion, templateFromDraft, type MessageDraft, type Suggested } from "@/components/whatsapp-message-card";

const PROBLEMS = {
  greeting: "Write a welcome of up to 300 characters.",
  prefill: "Write a pre-typed message of up to 300 characters.",
  questions: "Use 1 to 3 different questions of up to 40 characters.",
} as const;

/**
 * #840: "Edit for this campaign". The same fields and preview as the Brand card, pre-filled with
 * what this campaign sends. Only this campaign changes, unless "Also save as my message" is on.
 * The claim checks run in Review (and on save).
 */
export function CampaignWhatsAppMessageDialog({ businessId, businessName, firstOffer, initial, suggested, followsSuggestion, edited, onUse, onClose }: {
  businessId: string;
  businessName: string;
  firstOffer?: string | null;
  initial: MessageDraft;
  suggested: Suggested;
  /** The words are AdBrain's suggestion, so a language change swaps them until the owner types. */
  followsSuggestion: boolean;
  /** This campaign already has its own message, so it can go back to the saved or suggested one. */
  edited: boolean;
  /** `template` is this campaign's own message; null follows the business's (possibly just saved) message. */
  onUse: (template: WhatsAppTemplate | null, saved?: WhatsAppTemplate) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [typed, setTyped] = useState(false);
  const [alsoSave, setAlsoSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field?: string; text: string } | null>(null);

  const use = async () => {
    const template = templateFromDraft(draft);
    const parsed = whatsappTemplateSchema.safeParse(template);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      const field = path[0] === "greeting" ? "greeting" : path.includes("questions") ? "questions" : "prefill";
      setProblem({ field, text: PROBLEMS[field] });
      return;
    }
    if (!alsoSave) { onUse(parsed.data); return; }
    setBusy(true);
    const result = await saveWhatsAppTemplate({ businessId, template: parsed.data }).catch(() => ({ ok: false, error: "Couldn't save your WhatsApp message. Try again.", field: undefined }));
    setBusy(false);
    if (!result.ok) { setProblem({ field: result.field, text: result.error ?? "Couldn't save." }); return; }
    onUse(null, parsed.data);
  };
  const fieldError = (field: string) => problem?.field === field ? problem.text : null;

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
      <DialogTitle>WhatsApp message for this campaign</DialogTitle>
      <DialogDescription>What customers see after tapping this campaign&apos;s ads.</DialogDescription>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="grid min-w-0 gap-4">
          <WhatsAppMessageFields value={draft} allowAuto={false} fieldError={fieldError} firstOffer={firstOffer}
            onWords={(next) => { setDraft(next); setTyped(true); setProblem(null); }}
            onLanguage={(language) => { setProblem(null); setDraft((current) => followsSuggestion && !typed ? draftFromSuggestion(suggested, language) : { ...current, language }); }} />
          <div className="grid gap-0.5">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={alsoSave} aria-describedby="also-save-note" onChange={(event) => setAlsoSave(event.target.checked)} className="accent-blue-600" />
              Also save as my message
            </label>
            <span id="also-save-note" className="pl-6 text-xs text-slate-500">New WhatsApp campaigns will start from it. Running campaigns don&apos;t change.</span>
          </div>
          {problem && !problem.field && <Alert variant="error">{problem.text}</Alert>}
        </div>
        <DraftPreview businessName={businessName} draft={draft} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {edited && <Button type="button" variant="ghost" disabled={busy} onClick={() => onUse(null)}>Undo my edit</Button>}
        <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
        <Button type="button" disabled={busy} onClick={() => void use()}>{busy ? "Saving…" : "Use for this campaign"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
