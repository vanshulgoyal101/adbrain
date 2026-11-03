import type { Ref } from "react";

/** #847: sync and save news is a quiet line, as on Enquiries, not a green box on every visit. #2775: the per-campaign "left unchanged" names sit behind Details. */
export function CampaignSyncNotice({ notice, details, detailsLabel, ref }: { notice: string | null; details: string[]; detailsLabel: string; ref: Ref<HTMLParagraphElement> }) {
  return (
    <>
      <p ref={ref} aria-live="polite" className={notice ? "scroll-mt-20 text-sm text-slate-600" : "sr-only"}>{notice}</p>
      {notice && details.length > 0 && (
        <details className="-mt-2 text-sm text-slate-600">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-slate-700">{detailsLabel}</summary>
          <ul className="list-disc space-y-1 pb-2 pl-5">{details.map((line) => <li key={line}>{line}</li>)}</ul>
        </details>
      )}
    </>
  );
}
