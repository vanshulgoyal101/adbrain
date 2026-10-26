"use client";

import { useState, type ReactNode } from "react";
import { AdAssistant } from "@/components/ad-assistant";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import { Stepper, type AdFlowStep } from "@/components/ui/stepper";
import type { Business } from "@/lib/types";

/** The Create page's stepper follows the assistant (#760): Brief while the owner answers, Create once ads are made. */
export function CreateFlow({ business, opening, children }: { business: Business; opening: OpeningLine | null; children: ReactNode }) {
  const [step, setStep] = useState<AdFlowStep>("Brief");
  return (
    <>
      <Stepper current={step} className="mt-4" />
      <div className="mt-7 grid gap-8 border-t border-slate-200 pt-7 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <AdAssistant business={business} opening={opening} onFlowStep={setStep} />
        {children}
      </div>
    </>
  );
}
