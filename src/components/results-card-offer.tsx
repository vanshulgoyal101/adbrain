"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { shareCreative } from "@/lib/share-creative";

export type ResultsCardWords = { title: string; body: string; share: string; skip: string; footerToggle: string; shareFailed: string; preview: string };

/**
 * #2036 (CPO #2018): after a week with 5+ logged enquiries, Home offers a card for the owner's WhatsApp Status.
 * The card is fetched before the tap, so the share sheet opens inside it (iOS refuses a share after a slow wait).
 * Share or Not this week hides it for 7 days; the server words arrive resolved (no i18n bundle here).
 */
export function ResultsCardOffer({ businessId, caption, words }: { businessId: string; caption: string; words: ResultsCardWords }) {
  const [footer, setFooter] = useState(true);
  const [card, setCard] = useState<{ file: File; url: string; footer: boolean } | null>(null);
  const [state, setState] = useState<"ready" | "busy" | "hidden">("ready");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const key = `results-card-shown:${businessId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void record(businessId, "shown");
  }, [businessId]);

  useEffect(() => {
    let live = true;
    fetch(`/api/results-card?businessId=${encodeURIComponent(businessId)}${footer ? "" : "&footer=0"}`)
      .then((response) => response.ok && response.headers.get("content-type") === "image/jpeg" ? response.blob() : Promise.reject(new Error("card")))
      .then((blob) => {
        if (!live) return;
        setCard({ file: new File([blob], "adbrain-results.jpg", { type: "image/jpeg" }), url: URL.createObjectURL(blob), footer });
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [businessId, footer]);

  // Revoke a card's URL only once the next card replaces it, so the preview never blanks.
  const url = card?.url;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function share() {
    if (!card || card.footer !== footer) return;
    setState("busy");
    try {
      const outcome = await shareCreative({ headline: null, primary_text: caption, image_url: null }, card.file);
      if (outcome.kind === "cancelled") { setState("ready"); return; }
      await record(businessId, "shared");
      setState("hidden");
    } catch {
      setState("ready");
      setFailed(true);
    }
  }

  async function skip() {
    setState("busy");
    if (await record(businessId, "dismissed")) setState("hidden");
    else { setState("ready"); setFailed(true); }
  }

  if (state === "hidden") return null;
  const busy = state === "busy";
  const ready = Boolean(card && card.footer === footer);
  return (
    <section aria-label={words.title} className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-md bg-slate-100 sm:w-28">
        {card && <img src={card.url} alt={words.preview} className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{words.title}</p>
        <p className="mt-1 text-sm text-slate-600">{words.body}</p>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4" checked={footer} disabled={busy} onChange={(event) => { setFailed(false); setFooter(event.target.checked); }} />
          {words.footerToggle}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" className="min-h-11" disabled={busy || !ready} onClick={() => void share()}>{words.share}</Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void skip()}>{words.skip}</Button>
        </div>
        {failed && <p role="alert" className="mt-3 text-sm text-danger">{words.shareFailed}</p>}
      </div>
    </section>
  );
}

function record(businessId: string, event: "shown" | "shared" | "dismissed"): Promise<boolean> {
  return fetch("/api/results-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, event }) })
    .then((response) => response.ok, () => false);
}
