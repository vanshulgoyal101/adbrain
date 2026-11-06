import { Circle } from "lucide-react";
import { OWNER_WORDS } from "@/lib/copy/owner-words";

export function BrandPreview({ message, facts, checks }: {
  message: string;
  facts: [string, string][];
  checks: { label: string; ready: boolean; href?: string }[];
}) {
  const readyCount = checks.filter((check) => check.ready).length;

  return (
    <section
      aria-labelledby="brand-preview-title"
      className="grid gap-4 border-y border-slate-200 py-6 lg:order-first lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12"
    >
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="brand-preview-title" className="text-lg font-semibold text-slate-950">
            {OWNER_WORDS.preview}
          </h2>
          <span className="text-xs text-slate-500">
            {readyCount} of {checks.length} ready
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">What every ad will use. It updates as you type.</p>
        {readyCount < checks.length && (
          <ul className="mt-3 flex flex-col">
            {checks.filter((check) => !check.ready).map((check) => (
              <li key={check.label} className="flex min-h-11 items-center gap-2 text-sm text-slate-500">
                <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {check.href ? (
                  <a href={check.href} className="font-medium text-blue-700 underline-offset-2 hover:underline">
                    Add {check.label.toLowerCase()}
                  </a>
                ) : (
                  `Add ${check.label.toLowerCase()}`
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-lg font-semibold text-slate-950">{message}</p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-slate-500">{term}</dt>
              <dd className="text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
