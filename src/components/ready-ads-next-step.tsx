"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Download, Megaphone } from "lucide-react";
import { ShareCreativeButton } from "@/components/share-creative-button";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import type { Creative } from "@/lib/types";

/**
 * What a new owner sees on Campaigns before Facebook is connected (#336, CEO decision on #339):
 * share or download the approved ads today; launching opens after Meta's review, or on request.
 */
export function ReadyAdsNextStep({ approved, phone, businessId, sample = false }: {
  approved: Creative[]; phone: string | null; businessId: string;
  /** #1317: a prospect's ads are samples: Share is hidden; Download all goes through the marked export. */
  sample?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // #725: "Request sent" only once the server has recorded it, so the team is sure to see it.
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
      setRequestError("Your request didn't send. Check your connection and try again.");
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
      setDownloadError("The download didn't finish. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby="ready-ads-title" className="max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h2 id="ready-ads-title" className="text-xl font-semibold text-slate-900">Your ads are ready</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Launching on Facebook and Instagram opens soon. We&apos;ll WhatsApp you when it does. Until then, share your ads with customers yourself.
      </p>

      {newest?.image_url && (
        <img src={newest.image_url} alt={newest.headline ? `Your ad: ${newest.headline}` : "Your newest approved ad"} className="mt-5 aspect-[4/5] w-full max-w-xs rounded-md border border-slate-200 object-cover" />
      )}
      {newest && !sample && <ShareCreativeButton creative={newest} data-product-event="creative.share" className="mt-4 max-w-xs" />}

      <div className="mt-3 flex flex-col gap-1">
        <Button type="button" variant="outline" className="h-11 max-w-xs" disabled={downloading} onClick={downloadAll} data-product-event="creative.download">
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloading ? "Preparing download…" : approved.length === 1 ? "Download your ad" : `Download all ${approved.length} ads`}
        </Button>
        {downloadError && <p role="alert" className="text-xs text-red-600">{downloadError}</p>}
        {approved.length > 1 && <Link href="/studio?status=approved" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline">See all approved ads</Link>}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Want to run them on Facebook this week?</h3>
        {requested ? (
          <p role="status" className="mt-2 flex gap-2 text-sm leading-6 text-slate-700">
            <Check className="mt-1 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            {phone ? `Request sent. We'll WhatsApp you on ${phone} within a working day to switch on Facebook access.` : "Request sent. Add your WhatsApp number in Brand so we can reach you within a working day."}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm leading-6 text-slate-600">We can switch on early access for your Facebook account. You approve every rupee before anything runs.</p>
            <Button type="button" variant="ghost" className="mt-2 h-11 px-0 text-blue-700 hover:bg-transparent hover:underline" disabled={requesting} onClick={requestAccess} data-product-event="meta.access_request">
              <Megaphone className="h-4 w-4" aria-hidden="true" /> {requesting ? "Sending request…" : "Ask for Facebook access"}
            </Button>
            {requestError && <p role="alert" className="text-xs text-red-600">{requestError}</p>}
          </>
        )}
        <p className="mt-1 text-sm text-slate-600">
          Already have access? <Link href="/settings" className="inline-flex min-h-11 items-center font-medium text-blue-700 hover:underline" data-product-event="meta.connect">Connect Facebook</Link>
        </p>
      </div>
    </section>
  );
}
