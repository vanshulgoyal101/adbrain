import { CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import type { SetupRow } from "@/lib/meta/setup-checklist";

/** #1016: Settings' read-only Meta setup checklist: ✓ or one action per row, with a Hindi line under the English. */
export function MetaSetupChecklist({ rows }: { rows: SetupRow[] | null }) {
  return <section aria-labelledby="meta-setup-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
    <div>
      <h2 id="meta-setup-heading" className="font-semibold text-slate-900">Ready to launch on Meta</h2>
      <p className="mt-1 text-sm text-slate-600">Your own ad account and your own card: Meta bills you directly.</p>
    </div>
    {!rows ? <p className="text-sm text-slate-600">We couldn&apos;t read your Meta setup right now. Open Settings again in a minute.</p>
      : <ul className="space-y-3">
        {rows.map((row) => <li key={row.key} className="flex min-w-0 gap-3">
          {row.done
            ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-900">{row.label}<span className="sr-only">{row.done ? ": done" : ": needs action"}</span></p>
            {row.detail && <p className="break-words text-slate-600">{row.detail}</p>}
            {row.action && <div className="mt-1 space-y-1">
              <p className="text-slate-700">{row.action.en}</p>
              <p lang="hi" className="text-slate-600">{row.action.hi}</p>
              <a href={row.action.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 font-medium text-blue-700 underline">
                {row.action.label}<ExternalLink aria-hidden="true" className="h-4 w-4" /><span className="sr-only">(opens Meta in a new tab)</span>
              </a>
            </div>}
          </div>
        </li>)}
      </ul>}
  </section>;
}
