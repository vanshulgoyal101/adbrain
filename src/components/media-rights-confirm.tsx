"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { mediaTranslator, type Words } from "@/i18n/words";
import { MediaRightsConsent, mediaConsentComplete, type MediaConsentValue } from "@/components/media-rights-consent";

/**
 * #784: confirms rights for photos already in an ad (Review's "Confirm your rights" link), with no upload needed.
 * Saves through the same route as the upload sheet, then refreshes the page so the card goes away.
 */
export function MediaRightsConfirm({ businessId, vertical, words }: { businessId: string; vertical: string | null; words?: Words<"media"> }) {
  const router = useRouter();
  const t = useMemo(() => mediaTranslator(words), [words]);
  const [consent, setConsent] = useState<MediaConsentValue>({ rights: false, people: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/media/consent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, rights: consent.rights, people: consent.people }), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(response.status < 500 && body.error ? body.error : t("upload.consentFailed"));
        return;
      }
      router.replace("/assets");
      router.refresh();
    } catch {
      setError(t("upload.consentFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="media-rights-confirm-title" className="mt-6 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 id="media-rights-confirm-title" className="text-base font-semibold text-slate-900">{t("upload.confirmTitle")}</h2>
      <MediaRightsConsent t={t} vertical={vertical} value={consent} onChange={setConsent} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div>
        <Button onClick={confirm} disabled={saving || !mediaConsentComplete(consent, vertical)}>{saving ? t("upload.confirmSaving") : t("upload.confirmAction")}</Button>
      </div>
    </section>
  );
}
