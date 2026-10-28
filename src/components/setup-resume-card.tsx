import Link from "next/link";
import { SETUP_STEPS, type SetupStep } from "@/lib/setup/steps";

/** #1272: until the first ad is live, Home is this one card pointing at the saved step. */
export function SetupResumeCard({ step }: { step: SetupStep }) {
  const current = SETUP_STEPS[step - 1];
  return (
    <section aria-labelledby="resume-title" className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h1 id="resume-title" className="text-lg font-semibold text-slate-950">Your first ad</h1>
      <p className="mt-1 text-sm text-slate-600">Step {step} of 3 · {current.label}</p>
      <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
        {SETUP_STEPS.map((item) => <span key={item.step} className={item.step <= step ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-slate-200"} />)}
      </div>
      <Link href={current.href} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
        Continue
      </Link>
    </section>
  );
}
