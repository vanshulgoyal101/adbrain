import { CheckCircle2, ChevronRight, CircleAlert, ExternalLink } from "lucide-react";
import type { SetupRow } from "@/lib/meta/setup-checklist";
import { translator, type AppLocale } from "@/i18n/locale";

type Words = ReturnType<typeof translator<"settings">>;

function DoneRow({ row, t }: { row: SetupRow; t: Words }) {
  return <li className="flex min-w-0 items-start gap-2 text-sm text-slate-700">
    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
    <span className="min-w-0 break-words"><span lang="en">{row.label}{row.key === "portfolio" && row.detail && <span className="text-slate-500"> ({row.detail})</span>}</span><span className="sr-only">: {t("metaSetup.done")}</span></span>
  </li>;
}

/**
 * #1016: Settings' read-only Meta setup checklist. #847 calm by default: one line when all is set;
 * otherwise what to fix comes first (one action each, Hindi under English) and what's done is a short list.
 * #1438: the frame is in the owner's language; row labels and details still come in English from the check.
 */
export function MetaSetupChecklist({ rows, locale = "en" }: { rows: SetupRow[] | null; locale?: AppLocale }) {
  const t = translator(locale, "settings");
  const todo = rows?.filter((row) => !row.done) ?? [];
  const done = rows?.filter((row) => row.done) ?? [];
  return <section lang={locale} aria-labelledby="meta-setup-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
    <div>
      <h2 id="meta-setup-heading" className="font-semibold text-slate-900">{t("metaSetup.title")}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {!rows ? t("metaSetup.unread")
          : todo.length === 0 ? t("metaSetup.allSet", { count: rows.length })
          : todo.length === 1 ? t("metaSetup.toFixOne") : t("metaSetup.toFixMany", { count: todo.length })}
      </p>
    </div>
    {!rows ? <p className="text-sm text-slate-600">{t("metaSetup.readFailed")}</p>
      : <>
        {todo.length > 0 && <ul className="space-y-4">
          {todo.map((row) => <li key={row.key} className="flex min-w-0 gap-3">
            <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900"><span lang="en">{row.label}</span><span className="sr-only">: {t("metaSetup.needsAction")}</span></p>
              {row.detail && <p lang="en" className="break-words text-slate-600">{row.detail}</p>}
              {row.action && <div className="mt-1 space-y-1">
                <p lang="en" className="text-slate-700">{row.action.en}</p>
                <p lang="hi" className="text-slate-600">{row.action.hi}</p>
                {row.action.href && <a href={row.action.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 font-medium text-blue-700 underline">
                  <span lang="en">{row.action.label}</span><ExternalLink aria-hidden="true" className="h-4 w-4" /><span className="sr-only">{t("metaSetup.opensMeta")}</span>
                </a>}
              </div>}
            </div>
          </li>)}
        </ul>}
        {done.length > 0 && (todo.length > 0
          ? <ul aria-label={t("metaSetup.alreadySet")} className="grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">{done.map((row) => <DoneRow key={row.key} row={row} t={t} />)}</ul>
          : <details className="group text-sm">
            <summary className="flex min-h-10 w-fit cursor-pointer list-none items-center gap-2 font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-90" />{t("metaSetup.seeChecked")}
            </summary>
            <ul className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">{done.map((row) => <DoneRow key={row.key} row={row} t={t} />)}</ul>
          </details>)}
      </>}
  </section>;
}
