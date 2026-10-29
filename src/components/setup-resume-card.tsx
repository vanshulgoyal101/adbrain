import Link from "next/link";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { SETUP_STEPS, type SetupStep } from "@/lib/setup/steps";
import type { Creative } from "@/lib/types";
import { translator, type AppLocale } from "@/i18n/locale";

export type ReadyAd = Pick<Creative, "id" | "headline" | "image_url">;

const button = "mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground";

/**
 * #1272: until the first ad is live, Home is this one card pointing at the saved step.
 * #1712 (CPO, #1687): at step 3 with ads already made (a handed-over account), it shows them and the way to Go live.
 */
export function SetupResumeCard({ step, ready = [], locale = "en" }: { step: SetupStep; ready?: ReadyAd[]; locale?: AppLocale }) {
  const t = translator(locale, "setup");
  const lang = locale === "en" ? undefined : locale;
  const current = SETUP_STEPS[step - 1];
  const progress = (
    <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
      {SETUP_STEPS.map((item) => <span key={item.step} className={item.step <= step ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-slate-200"} />)}
    </div>
  );
  if (step === 3 && ready.length) {
    return (
      <section aria-labelledby="resume-title" lang={lang} className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <h1 id="resume-title" className="text-lg font-semibold text-slate-950">
          {ready.length === 1 ? t("resume.readyOne") : t("resume.readyMany", { n: ready.length })}
        </h1>
        {progress}
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {ready.slice(0, 3).map((ad) => (
            <li key={ad.id}>
              <Link href={current.href} className="block aspect-square overflow-hidden rounded-md bg-slate-100">
                {ad.image_url && <img src={creativeThumbnailUrl(ad.image_url)} alt={ad.headline || t("resume.title")} className="h-full w-full object-cover" loading="lazy" />}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-700">{t("resume.next")}</p>
        <Link href={current.href} className={button}>{t("resume.connect")}</Link>
      </section>
    );
  }
  return (
    <section aria-labelledby="resume-title" lang={lang} className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h1 id="resume-title" className="text-lg font-semibold text-slate-950">{t("resume.title")}</h1>
      <p className="mt-1 text-sm text-slate-600">{t("stepOf", { n: step })} · {t(`step${step}`)}</p>
      {progress}
      <Link href={current.href} className={button}>
        {t("resume.continue")}
      </Link>
    </section>
  );
}
