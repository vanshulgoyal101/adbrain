"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpOnWhatsApp } from "@/components/support-link";
import { cn } from "@/lib/utils";

/** #1251 WS1: the first-timer's three steps, in the owner's words. */
export const SETUP_STEPS = [
  { step: 1, label: "Your business", href: "/brand" },
  { step: 2, label: "Your ads", href: "/create" },
  { step: 3, label: "Go live", href: "/campaigns" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["step"];

/** A first-timer has no campaign that ever went live (`launched_at` is the first confirmed activation) or is on now (imported from Meta). */
export function firstTimer(campaigns: { launched_at: string | null; status?: string }[]): boolean {
  return !campaigns.some((campaign) => campaign.launched_at || campaign.status === "active");
}

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

      <div className="flex-1 pt-6 pb-6">{children}</div>

      <nav aria-label="Setup steps"
        className="sticky bottom-0 -mx-4 flex gap-3 border-t border-slate-200 bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:px-0">
        {back}
        <Button type="button" className="flex-1" disabled={primary.disabled || leaving}
          onClick={() => primary.href ? void leave(primary.href) : primary.onClick?.()}>
          {primary.label}
        </Button>
      </nav>
    </div>
  );
}
