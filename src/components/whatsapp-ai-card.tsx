"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Language = "en" | "hinglish";

// #794: the CPO's guide, from Meta's own pages (read Oct 26, 2026). "Free" stays out until a pilot verifies it.
const GUIDE: Record<Language, { lead: string; intro: string; app: string; steps: React.ReactNode[]; note: string }> = {
  en: {
    lead: "Reply to every ad enquiry in seconds, even when you're busy.",
    intro: "WhatsApp's own AI can answer people who message you from your ad.",
    app: "Using normal WhatsApp? This is only in the free WhatsApp Business app.",
    steps: [
      <>Open <strong>WhatsApp Business → Tools → Business AI</strong> (it may be called &quot;Meta Business Agent&quot;). Tap <strong>Confirm</strong>.</>,
      <>Let it learn from your past chats. Add your <strong>price list or catalog</strong> and your <strong>website</strong> if you have one.</>,
      <>Under <strong>who it replies to</strong>, choose <strong>&quot;Customers coming from your ads&quot;</strong>. Chat with it once to test, then switch it on.</>,
    ],
    note: "You can take over any chat at any time. Not available for your business yet? Meta is rolling it out to more businesses; skip this for now.",
  },
  hinglish: {
    lead: "Ad se aane wale har message ka jawab seconds mein, jab aap busy ho tab bhi.",
    intro: "WhatsApp ka apna AI aapke ad se aaye logon ko jawab de sakta hai.",
    app: "Normal WhatsApp hai? Ye sirf free WhatsApp Business app mein hai.",
    steps: [
      <><strong>WhatsApp Business → Tools → Business AI</strong> kholiye (naam &quot;Meta Business Agent&quot; bhi ho sakta hai). <strong>Confirm</strong> dabaiye.</>,
      <>Use purani chats se seekhne dijiye. Apni <strong>price list ya catalog</strong> aur <strong>website</strong> (agar hai) jodiye.</>,
      <><strong>Kisko jawab de</strong> mein <strong>&quot;Customers coming from your ads&quot;</strong> chuniye. Ek baar khud chat karke test kijiye, phir on kar dijiye.</>,
    ],
    note: "Aap kabhi bhi chat apne haath mein le sakte hain. Aapke business ke liye abhi nahi dikh raha? Meta dheere-dheere sabko de raha hai, abhi skip kar dijiye.",
  },
};

const storageKey = (businessId: string) => `whatsapp-ai:${businessId}`;

const ANSWERED = "whatsapp-ai-answered";

const LATER_MS = 7 * 86_400_000;

/** The stored answer; "Not now" (`later:<ms>`) counts only for 7 days. */
function readAnswer(businessId: string, now = Date.now()): string | null {
  let value: string | null;
  try { value = localStorage.getItem(storageKey(businessId)); } catch { return null; }
  if (value?.startsWith("later:")) return now - Number(value.slice(6)) < LATER_MS ? value : null;
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(ANSWERED, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(ANSWERED, onChange); };
}

/**
 * #794: after a WhatsApp campaign launches, point the owner to Meta's own AI reply in the WhatsApp
 * Business app instead of building ours. The answer is logged per business (`/api/events` adds it).
 */
export function WhatsAppAiCard({ businessId }: { businessId: string }) {
  // Hidden on the server and until the stored answer is read, so it never flashes for owners who answered.
  const stored = React.useSyncExternalStore(subscribe, () => readAnswer(businessId) ?? "", () => "server");
  const [dismissed, setDismissed] = React.useState(false);
  const answered = dismissed || stored !== "";
  const [open, setOpen] = React.useState(false);
  const [language, setLanguage] = React.useState<Language>("en");

  const answer = (value: "done" | "unavailable" | "later") => {
    try { localStorage.setItem(storageKey(businessId), value === "later" ? `later:${Date.now()}` : value); } catch { /* hidden for this visit only */ }
    setDismissed(true);
    setOpen(false);
    window.dispatchEvent(new Event(ANSWERED));
  };
  if (answered) return null;
  const guide = GUIDE[language];

  return (
    <section aria-labelledby="whatsapp-ai-title" className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <div className="min-w-0">
          <h3 id="whatsapp-ai-title" className="font-medium text-slate-900">Reply faster with WhatsApp&apos;s AI?</h3>
          <p className="text-sm text-slate-700">It can answer people who message you from your ad, in your language, while you&apos;re busy.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="h-11" data-product-event="whatsapp_ai.guide" onClick={() => setOpen(true)}>Show me how</Button>
        <Button variant="outline" className="h-11" data-product-event="whatsapp_ai.done" onClick={() => answer("done")}>Already on</Button>
        <Button variant="outline" className="h-11" data-product-event="whatsapp_ai.unavailable" onClick={() => answer("unavailable")}>Not available for me</Button>
        <Button variant="ghost" className="h-11" data-product-event="whatsapp_ai.later" onClick={() => answer("later")}>Not now</Button>
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-slate-950">Turn on WhatsApp&apos;s AI reply</DialogTitle>
                <DialogDescription className="mt-0.5 text-sm text-slate-600">{guide.lead}</DialogDescription>
              </div>
              <DialogClose aria-label="Close the WhatsApp AI guide" />
            </header>
            <div className="flex flex-col gap-4 px-5 py-4">
              <div role="group" aria-label="Language" className="flex gap-2">
                {([["en", "English"], ["hinglish", "Hinglish"]] as const).map(([value, label]) => (
                  <Button key={value} variant={language === value ? "primary" : "outline"} className="h-11" aria-pressed={language === value} onClick={() => setLanguage(value)}>{label}</Button>
                ))}
              </div>
              <p className="text-sm text-slate-700">{guide.intro}</p>
              <p className="text-sm font-medium text-slate-800">{guide.app}</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-800">
                {guide.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
              <p className="text-sm text-slate-600">{guide.note}</p>
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="outline" className="h-11" data-product-event="whatsapp_ai.unavailable" onClick={() => answer("unavailable")}>Not available for me</Button>
              <Button className="h-11" data-product-event="whatsapp_ai.done" onClick={() => answer("done")}>I switched it on</Button>
            </footer>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
