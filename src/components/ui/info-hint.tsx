"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small "?" info affordance that reveals a short explanation on hover or
 * focus/click. Keeps campaign options self-explanatory for non-expert users.
 */
export function InfoHint({
  children,
  className,
  label = "More info",
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const id = React.useId();
  const root = React.useRef<HTMLSpanElement>(null);
  const tooltip = React.useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = React.useState({ offset: 0, below: false });
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const open = (hovered || focused) && !dismissed;

  React.useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!root.current || !tooltip.current) return;
      const anchor = root.current.getBoundingClientRect();
      const content = tooltip.current.getBoundingClientRect();
      const centered = anchor.left + anchor.width / 2 - content.width / 2;
      const left = Math.max(8, Math.min(centered, document.documentElement.clientWidth - content.width - 8));
      setPlacement({ offset: left - centered, below: anchor.top < content.height + 8 });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => { event.currentTarget.focus(); setDismissed(false); }}
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => setFocused(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          ref={tooltip}
          id={id}
          role="tooltip"
          style={{ marginLeft: placement.offset }}
          className={cn("absolute left-1/2 z-20 w-56 max-w-[calc(100vw-1rem)] -translate-x-1/2 text-xs font-normal leading-relaxed text-white", placement.below ? "top-full pt-1.5" : "bottom-full pb-1.5")}
        >
          <span className="block rounded-lg bg-slate-900 px-3 py-2 shadow-lg">{children}</span>
        </span>
      )}
    </span>
  );
}
