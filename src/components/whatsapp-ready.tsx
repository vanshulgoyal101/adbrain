"use client";

import { useId, useSyncExternalStore } from "react";
import { MessageCircle } from "lucide-react";

/**
 * #493: people opened WhatsApp from the ad and left (#157: 12 opened, 1 messaged). These live in the
 * owner's WhatsApp Business app, which AdBrain can't read, so the owner ticks them; ticks are kept
 * on this device per business.
 */
const ITEMS = [
  { id: "profile", label: "Profile photo and business name", hint: "WhatsApp Business → Settings → Business tools → Business profile." },
  { id: "greeting", label: "Greeting message", hint: "Business tools → Greeting message: thank them and say what happens next." },
  { id: "away", label: "Away message", hint: "Business tools → Away message, outside your hours, with when you'll reply." },
  { id: "reply", label: "Reply within 5 minutes", hint: "Turn on WhatsApp notifications; a fast first reply wins the enquiry." },
] as const;

type ItemId = (typeof ITEMS)[number]["id"];
const CHANGED = "adbrain:whatsapp-ready";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function WhatsAppReadyChecklist({ businessId }: { businessId: string }) {
  const key = `whatsapp-ready:${businessId}`;
  const titleId = useId();
  // The server (and first client render) sees nothing ticked, so hydration matches.
  const stored = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } }, () => "[]");
  const done: ItemId[] = (() => {
    try {
      const saved: unknown = JSON.parse(stored);
      return Array.isArray(saved) ? ITEMS.map((item) => item.id).filter((id) => saved.includes(id)) : [];
    } catch { return []; }
  })();

  function toggle(id: ItemId) {
    const next = done.includes(id) ? done.filter((item) => item !== id) : [...done, id];
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event(CHANGED));
  }

  return (
    // #847: one quiet line that opens, instead of a green panel above every campaign.
    <section aria-labelledby={titleId}>
      <details className="group border-y border-slate-200">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-2 [&::-webkit-details-marker]:hidden">
          <span id={titleId} className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <MessageCircle className="h-4 w-4 text-slate-500" aria-hidden="true" />WhatsApp ready?
          </span>
          <span className="text-sm text-slate-600">{done.length} of {ITEMS.length} ready</span>
        </summary>
        <p className="text-sm text-slate-600">People who tap your ad land in your WhatsApp. These make them send the message.</p>
        <ul className="mt-2 flex flex-col pb-2">
          {ITEMS.map((item) => (
            <li key={item.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="checkbox" checked={done.includes(item.id)} onChange={() => toggle(item.id)} className="mt-0.5 size-5 shrink-0 accent-primary" />
                <span className="text-sm">
                  <span className="font-medium text-slate-900">{item.label}</span>
                  <span className="block text-slate-600">{item.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
