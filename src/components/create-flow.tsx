"use client";

import { useState, type ReactNode } from "react";
import { AdAssistant } from "@/components/ad-assistant";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import { Stepper, type AdFlowStep } from "@/components/ui/stepper";
import type { Suggestion } from "@/lib/seasonal";
import type { Business } from "@/lib/types";

/** The Create page's stepper follows the assistant (#760): Brief while the owner answers, Create once ads are made. */
export function CreateFlow({ business, opening, occasions, children }: { business: Business; opening: OpeningLine | null; occasions?: Suggestion[]; children: ReactNode }) {
  const [step, setStep] = useState<AdFlowStep>("Brief");
  return (
    <>
      <Stepper current={step} className="mt-4" />
      <div className="mt-6 flex flex-col gap-8 border-t border-slate-200 pt-6">
        <AdAssistant business={business} opening={opening} occasions={occasions} onFlowStep={setStep} />
        {children}
      </div>
    </>
  );
}
