"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AdComposite } from "@/lib/creative/ad-composite";
import type { AdDesignSpec } from "@/lib/creative/design";

/** What the editor wants shown in place of the ad's picture while editing (#387). */
export type PicturePreview = {
  /** The overlay spec with the unsaved words, drawn instantly in the browser. */
  spec: AdDesignSpec;
  /** The exact server render of the same words, once it arrives. */
  renderedUrl?: string | null;
};

/**
 * Live preview of the ad's picture: the overlay drawn in the browser at once, then the
 * real render (same fonts, Indic shaping) swapped in. Fits inside its parent like object-contain.
 */
export function LivePicture({ preview }: { preview: PicturePreview }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { spec, renderedUrl } = preview;
  const scale = size ? Math.min(size.width / spec.width, size.height / spec.height) : 0;
  return (
    <div ref={box} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {renderedUrl ? (
        <img src={renderedUrl} alt="Preview of the edited picture" className="h-full w-full object-contain" />
      ) : scale > 0 ? (
        <div
          role="img"
          aria-label="Preview of the edited picture"
          style={{ position: "relative", overflow: "hidden", width: spec.width * scale, height: spec.height * scale }}
        >
          <div style={{ width: spec.width, height: spec.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <AdComposite spec={spec} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
