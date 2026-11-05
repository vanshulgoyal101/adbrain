"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Download, Megaphone } from "lucide-react";
import { ShareCreativeButton } from "@/components/share-creative-button";
import { Button } from "@/components/ui/button";
import { setupTranslator, type SetupWords } from "@/i18n/setup-words";
import { downloadBlob } from "@/lib/download";
import type { Creative } from "@/lib/types";

/**
 * What a new owner sees on Campaigns before Facebook is connected (#336, CEO decision on #339):
 * share or download the approved ads today. When the App Review gate is on (#2697), it explains that Meta
 * approval is needed and records an access request without promising a date. Once the gate is off it offers Connect.
 */
export function ReadyAdsNextStep({ approved, businessId, sample = false, appReviewPending = true, words }: {
  approved: Creative[]; businessId: string;
  /** #1317: a prospect's ads are samples: Share is hidden; Download all goes through the marked export. */
  sample?: boolean;
  /** #1989: `META_APP_REVIEW_PENDING`; a new Facebook account can't connect until Meta approves AdBrain. */
  appReviewPending?: boolean;
  /** #2697: the owner's app language (the `setup` namespace); English without it. */
  words?: SetupWords;
}) {
  const t = setupTranslator(words);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // #725: "Request received" only once the server has recorded it, so the team is sure to see it.
  async function requestAccess() {
    setRequesting(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/meta/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      if (!res.ok) throw new Error();
      setRequested(true);
    } catch {
      setRequestError(t("access.requestFailed"));
    } finally {
      setRequesting(false);
    }
  }
  const newest = approved[0];

  async function downloadAll() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/creatives/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creativeIds: approved.slice(0, 50).map((creative) => creative.id) }),
      });
      if (!res.ok) throw new Error();
      downloadBlob(await res.blob(), "adbrain-ad-pack.zip");
    } catch {
      setDownloadError(t("readyAds.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby="ready-ads-title" className="max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h2 id="ready-ads-title" className="text-xl font-semibold text-slate-900">{t("readyAds.title")}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t(appReviewPending ? "access.pending" : "readyAds.connectFirst")}</p>

      {newest?.image_url && (
        <img src={newest.image_url} alt={newest.headline ? t("readyAds.yourAd", { headline: newest.headline }) : t("readyAds.newestAd")} className="mt-5 aspect-[4/5] w-full max-w-xs rounded-md border border-slate-200 object-cover" />
      )}
      {newest && !sample && <ShareCreativeButton creative={newest} data-product-event="creative.share" className="mt-4 max-w-xs" />}

      <div className="mt-3 flex flex-col gap-1">
        <Button type="button" variant="outline" className="h-11 max-w-xs" disabled={downloading} onClick={downloadAll} data-product-event="creative.download">
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloading ? t("readyAds.preparing") : approved.length === 1 ? t("readyAds.downloadOne") : t("readyAds.downloadAll", { n: approved.length })}
        </Button>
        {downloadError && <p role="alert" className="text-xs text-red-600">{downloadError}</p>}
        {approved.length > 1 && <Link href="/studio?status=approved" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline">{t("readyAds.seeAll")}</Link>}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">{t("readyAds.runTitle")}</h3>
        {!appReviewPending ? (
          <Link href="/settings" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" data-product-event="meta.connect">{t("readyAds.connect")}</Link>
        ) : (
          <>
            {requested ? (
              <p role="status" className="mt-2 flex gap-2 text-sm leading-6 text-slate-700">
                <Check className="mt-1 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                {t("access.requested")}
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm leading-6 text-slate-600">{t("readyAds.askBody")}</p>
                <Button type="button" variant="ghost" className="mt-2 h-11 px-0 text-blue-700 hover:bg-transparent hover:underline" disabled={requesting} onClick={requestAccess} data-product-event="meta.access_request">
                  <Megaphone className="h-4 w-4" aria-hidden="true" /> {requesting ? t("readyAds.asking") : t("readyAds.ask")}
                </Button>
                {requestError && <p role="alert" className="text-xs text-red-600">{requestError}</p>}
              </>
            )}
            <p className="mt-1 text-sm text-slate-600">
              {t("readyAds.haveAccess")} <Link href="/settings" className="inline-flex min-h-11 items-center font-medium text-blue-700 hover:underline" data-product-event="meta.connect">{t("readyAds.connect")}</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
