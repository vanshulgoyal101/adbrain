import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import en from "../../../messages/en.json";

export const AD_FLOW = ["Brief", "Create", "Review", "Launch"] as const;
export type AdFlowStep = (typeof AD_FLOW)[number];

/** The one flow (#403): Brief → Create → Review → Launch. Earlier steps show a tick, never a number. */
export function Stepper({ current, details = {}, className, labels = en.create, lang }: {
  current: AdFlowStep;
  /** Screen-reader context per step, e.g. "12 awaiting approval". */
  details?: Partial<Record<AdFlowStep, string>>;
  className?: string;
  /** #1438: the step names and list name in the owner's language; English when none are passed. */
  labels?: Record<AdFlowStep | "steps", string>;
  lang?: string;
}) {
  const at = AD_FLOW.indexOf(current);
  return (
    <ol aria-label={labels.steps} lang={lang} className={cn("flex flex-wrap items-center gap-y-1 text-sm", className)}>
      {AD_FLOW.map((step, index) => (
        <li key={step} aria-current={index === at ? "step" : undefined} className="flex items-center">
          {index > 0 && <span aria-hidden="true" className="mx-0.5 h-px w-3 bg-slate-300 sm:mx-1 sm:w-8" />}
          <span className={cn(
            "inline-flex min-h-9 items-center gap-1 rounded-full px-2 sm:gap-1.5 sm:px-3",
            index === at ? "bg-lime-wash font-semibold text-slate-900" : index < at ? "text-slate-700" : "text-slate-500",
          )}>
            {index < at && <Check size={14} aria-hidden="true" className="text-primary" />}
            {labels[step]}
            {details[step] && <span className="sr-only">: {details[step]}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
