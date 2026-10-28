"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpOnWhatsApp } from "@/components/support-link";
import { cn } from "@/lib/utils";

import { SETUP_STEPS, type SetupStep } from "@/lib/setup/steps";

export { SETUP_STEPS, firstTimer, type SetupStep } from "@/lib/setup/steps";

type Primary = { label: string; disabled?: boolean } & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

/**
 * #1268: the frame each first-timer step sits in: progress strip with Saved, the step, and a sticky
 * bottom bar with one primary (+ Back from step 2). Back-safe: leaving waits for the step's own save
 * (`beforeLeave`) and stays put if it fails; Back goes to the step before, never browser history.
 */
export function SetupSpine({ step, saved = null, beforeLeave, primary, children }: {
  step: SetupStep;
  saved?: "saving" | "saved" | "failed" | null;
  beforeLeave?: () => Promise<void>;
  primary: Primary;
  children: ReactNode;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  // #1251 Designer walk: a focused field scrolls clear of the sticky bottom bar (about 96 px), not behind it.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "7rem";
    return () => { root.style.scrollPaddingBottom = before; };
  }, []);
  const current = SETUP_STEPS[step - 1];
  const previous = step > 1 ? SETUP_STEPS[step - 2] : null;

  async function leave(href: string) {
    if (leaving) return;
    setLeaving(true);
    try {
      await beforeLeave?.();
      router.push(href);
    } catch {
      // The step shows its own save error; the owner stays here with their input.
    } finally {
      setLeaving(false);
    }
  }

  const back = previous && (
    <Button type="button" variant="outline" onClick={() => void leave(previous.href)} disabled={leaving}>
      Back
    </Button>
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {previous && (
            <button type="button" onClick={() => void leave(previous.href)} disabled={leaving} aria-label={`Back to ${previous.label}`}
              className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          )}
          <h1 className="truncate text-base font-semibold text-slate-900">Set up your first ad</h1>
        </div>
        <HelpOnWhatsApp label="Help" />
      </div>

      <div role="group" aria-label={`Step ${step} of 3: ${current.label}`} className="mt-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="text-slate-600"><span className="font-semibold text-slate-900">Step {step} of 3</span> <span aria-hidden="true">·</span> <span>{current.label}</span></p>
          <p role="status" className={cn("text-xs", saved === "failed" ? "font-medium text-red-800" : "text-slate-500")}>{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "failed" ? "Not saved. Check your connection." : ""}</p>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
          {SETUP_STEPS.map((item) => (
            <span key={item.step} data-segment={item.step < step ? "done" : item.step === step ? "current" : "todo"}
              className={cn("h-1 rounded-full", item.step <= step ? "bg-primary" : "bg-slate-200")} />
          ))}
        </div>
      </div>

      <div className="flex-1 pt-6 pb-8">{children}</div>

      <nav aria-label="Setup steps"
        className="sticky bottom-0 -mx-4 flex gap-3 border-t border-slate-200 bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:px-0">
        {back}
        <Button type="button" className="flex-1 sm:flex-none sm:px-6" disabled={primary.disabled || leaving}
          onClick={() => primary.href ? void leave(primary.href) : primary.onClick?.()}>
          {primary.label}
        </Button>
      </nav>
    </div>
  );
}
