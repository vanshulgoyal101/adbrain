"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { OnboardingProgress, StepStatus } from "@/lib/managed/onboarding";

type CustomerStep = keyof OnboardingProgress["customer"];
type BackgroundStep = keyof OnboardingProgress["background"];

const CUSTOMER: { key: CustomerStep; title: string; detail: string }[] = [
  { key: "pay", title: "Add money for ads", detail: "Your ads spend only what you add. You can stop any time." },
  { key: "page", title: "Choose your Facebook Page", detail: "Ads run from your own Page, under your business name." },
  { key: "whatsapp", title: "Connect your WhatsApp", detail: "People who tap your ad message you on this number." },
  { key: "card", title: "Add your card on Facebook", detail: "Facebook charges your ads to your own card. Whoever holds the card adds it on Facebook." },
];

const BACKGROUND: { key: BackgroundStep; title: string; waitingFor: string }[] = [
  { key: "childBusiness", title: "Your business on Meta", waitingFor: "Starts after you choose your Page" },
  { key: "adAccount", title: "Your ad account", waitingFor: "Starts after your business on Meta" },
];

const FAILED_COPY: Record<CustomerStep | BackgroundStep, string> = {
  pay: "Your payment didn't go through. Try again, or use another card or UPI.",
  page: "We couldn't use that Page. Choose it again, or pick another Page.",
  whatsapp: "We couldn't connect that WhatsApp number. Try again.",
  childBusiness: "Meta didn't create your business. We're looking into it; nothing has been spent.",
  adAccount: "Meta didn't create your ad account. We're looking into it; nothing has been spent.",
  card: "Facebook couldn't use the card on your ad account, so no ads can run yet. Add another card on Facebook, then check again.",
};

function Marker({ status, index }: { status: StepStatus; index: number }) {
  if (status === "done") return <span className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-white"><Check className="size-4" aria-hidden="true" /></span>;
  if (status === "failed") return <span className="flex size-8 items-center justify-center rounded-full bg-red-50 text-red-700"><AlertTriangle className="size-4" aria-hidden="true" /></span>;
  return (
    <span className={cn("flex size-8 items-center justify-center rounded-full border text-sm font-semibold",
      status === "current" ? "border-blue-600 text-blue-700" : "border-slate-300 text-slate-500")}>{index}</span>
  );
}

const STATUS_TEXT: Record<StepStatus, string> = { done: "Done", current: "Your turn", working: "Setting up", waiting: "Not yet", failed: "Stopped" };

/**
 * #526: one screen from sign-up to 'Ready to advertise'. The owner's four steps, in order, with the
 * current one open (its content comes from `steps`), and AdBrain's background work beside them.
 */
export function ManagedOnboarding({ progress, steps }: { progress: OnboardingProgress; steps: Record<CustomerStep, ReactNode> }) {
  if (progress.ready) {
    return (
      <section aria-labelledby="onboarding-title" className="mx-auto max-w-xl py-10">
        <h1 id="onboarding-title" className="text-2xl font-semibold text-slate-950">Ready to advertise</h1>
        <p className="mt-2 text-slate-600">Your Page, WhatsApp and ad account are set up. Make your first ads next.</p>
        <Link href="/create" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700">Create ads</Link>
      </section>
    );
  }
  const failed = progress.failed;
  return (
    <section aria-labelledby="onboarding-title" className="mx-auto grid max-w-5xl gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <h1 id="onboarding-title" className="text-2xl font-semibold text-slate-950">Get ready to advertise</h1>
        <p className="mt-2 max-w-prose text-slate-600">Four steps from you. AdBrain sets up the rest while you go.</p>
        {failed && (
          <Alert variant="error" className="mt-6">
            <p>{FAILED_COPY[failed.step]}</p>
            {failed.code && <p className="mt-1 text-sm">Reference for support: <code>{failed.code}</code></p>}
          </Alert>
        )}
        <ol className="mt-8 space-y-4" aria-label="Your steps">
          {CUSTOMER.map((step, index) => {
            const status = progress.customer[step.key];
            const open = status === "current" || status === "failed";
            return (
              <li key={step.key} aria-current={status === "current" ? "step" : undefined}
                className={cn("rounded-lg border p-4", open ? "border-blue-200 bg-white shadow-sm" : "border-slate-200")}>
                <div className="flex items-start gap-3">
                  <Marker status={status} index={index + 1} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <h2 className="font-semibold text-slate-950">{step.title}</h2>
                      <span className="text-sm text-slate-600">{STATUS_TEXT[status]}</span>
                    </div>
                    {open && <p className="mt-1 text-sm text-slate-600">{step.detail}</p>}
                  </div>
                </div>
                {open && <div className="mt-4 sm:pl-11">{steps[step.key]}</div>}
              </li>
            );
          })}
        </ol>
      </div>
      <aside aria-labelledby="background-title" className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h2 id="background-title" className="font-semibold text-slate-950">What AdBrain is doing</h2>
        <p className="mt-1 text-sm text-slate-600">Usually under a minute each. You can leave this page; it keeps going.</p>
        <ul className="mt-4 space-y-3">
          {BACKGROUND.map((step) => {
            const status = progress.background[step.key];
            return (
              <li key={step.key} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  {status === "done" ? <Check className="size-4 text-blue-700" />
                    : status === "working" ? <Loader2 className="size-4 animate-spin text-slate-600" />
                      : status === "failed" ? <AlertTriangle className="size-4 text-red-700" />
                        : <span className="size-2 rounded-full bg-slate-300" />}
                </span>
                <span>
                  <span className="block font-medium text-slate-900">{step.title}</span>
                  <span className="block text-slate-600">{status === "waiting" ? step.waitingFor : STATUS_TEXT[status]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
    </section>
  );
}
