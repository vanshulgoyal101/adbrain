"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SAMPLE_LABEL } from "@/lib/creative/sample-label";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";

type SampleAd = { id: string; headline: string | null; image_url: string | null };

/**
 * #1502: a prospect's ads shown full screen on the phone during a sales visit, one at a time (swipe or arrows).
 * Every picture carries the export's sample label, and long-press saving is off, so the view never gives a clean picture.
 */
export function SampleViewer({ ads, onClose }: { ads: SampleAd[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const shown = ads.filter((ad) => ad.image_url);

  useEffect(() => {
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const go = (to: number) => {
    const next = Math.max(0, Math.min(shown.length - 1, to));
    track.current?.scrollTo({ left: next * track.current.clientWidth, behavior: "smooth" });
    setIndex(next);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Sample ads" className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex justify-end px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button ref={close} type="button" onClick={onClose} aria-label="Close" className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/10">
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      <div ref={track} onScroll={(event) => setIndex(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]">
        {shown.map((ad) => (
          <div key={ad.id} className="flex w-full shrink-0 snap-center items-center justify-center px-3">
            <figure className="relative max-h-full select-none [-webkit-touch-callout:none]" onContextMenu={(event) => event.preventDefault()}>
              {/* The thumbnail step 2 already loaded fills in while the full picture arrives on mobile data. */}
              <img src={ad.image_url!} alt={ad.headline ?? "Sample ad"} draggable={false}
                style={{ backgroundImage: `url("${creativeThumbnailUrl(ad.image_url!)}")` }}
                className="pointer-events-none block max-h-[calc(100svh-8.5rem)] w-auto max-w-full bg-cover bg-center object-contain" />
              <figcaption className="absolute bottom-[4%] left-[4%] inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-950">
                <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                {SAMPLE_LABEL}
              </figcaption>
            </figure>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-6 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous ad"
          className="inline-flex size-11 items-center justify-center rounded-full border border-white/30 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <p aria-live="polite" className="min-w-14 text-center text-sm text-white/80">{index + 1} of {shown.length}</p>
        <button type="button" onClick={() => go(index + 1)} disabled={index >= shown.length - 1} aria-label="Next ad"
          className="inline-flex size-11 items-center justify-center rounded-full border border-white/30 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
