"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { editableAds } from "@/lib/campaign/ad-edit-copy";
import { savedCreativeDescription } from "@/lib/creative/concept";
import type { Campaign, Creative } from "@/lib/types";
import { campaignsTranslator, type Words as Messages } from "@/i18n/words";

type Words = { headline: string; message: string; description: string };

/**
 * #775: change the words on a launched ad. Saving makes a new version on Meta and the ad goes back
 * to review; the picture, audience and budget don't change.
 */
/** Words an earlier edit put on each ad (`raw.adWords`, #775); they win over the creative's. */
function adWordsOf(campaign: Pick<Campaign, "raw">): Record<string, Partial<Words>> {
  const raw = campaign.raw as { adWords?: unknown } | null;
  const words = raw?.adWords;
  if (!words || typeof words !== "object" || Array.isArray(words)) return {};
  return Object.fromEntries(Object.entries(words as Record<string, unknown>).map(([adId, value]) => [adId,
    value && typeof value === "object" ? Object.fromEntries((["headline", "message", "description"] as const)
      .flatMap((field) => typeof (value as Record<string, unknown>)[field] === "string" ? [[field, (value as Record<string, string>)[field]]] : [])) : {}]));
}

export function EditAdDialog({ campaign, campaignName, creatives, onClose, onSaved, hint, words: messages }: {
  campaign: Pick<Campaign, "id" | "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw" | "creative_ids">;
  campaignName: string;
  creatives: Creative[];
  onClose: () => void;
  /** `change` is what the ad now says differently, for the caller's copy of the campaign. */
  onSaved: (message: string, saved: { adId: string; change: Partial<Words> }) => void;
  /** #1274: why the owner was sent here (the card's "Edit the ad"), shown above the ad text. */
  hint?: string;
  /** The owner's `campaigns` words (#1438); English without them. */
  words?: Messages<"campaigns">;
}) {
  const t = campaignsTranslator(messages);
  const campaignId = campaign.id;
  const ads = React.useMemo(() => editableAds(campaign, campaign.creative_ids ?? []).map((ad) => {
    const creative = creatives.find((item) => item.id === ad.creativeId);
    const edited = adWordsOf(campaign)[ad.adId] ?? {};
    const words: Words = { headline: creative?.headline ?? "", message: creative?.primary_text ?? "", description: savedCreativeDescription(creative?.generation) ?? "", ...edited };
    return { ...ad, label: `${ad.label}${words.headline ? `: ${words.headline}` : ""}`, words };
  }), [campaign, creatives]);
  const [adId, setAdId] = React.useState(ads[0]?.adId ?? "");
  const current = ads.find((ad) => ad.adId === adId);
  const [words, setWords] = React.useState<Words>(current?.words ?? { headline: "", message: "", description: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef<string | null>(null);
  const ids = { ad: React.useId(), headline: React.useId(), message: React.useId(), description: React.useId() };

  const pick = (next: string) => {
    setAdId(next);
    setWords(ads.find((ad) => ad.adId === next)?.words ?? { headline: "", message: "", description: "" });
    setError(null);
    key.current = null;
  };
  const edit = (patch: Partial<Words>) => { setWords((value) => ({ ...value, ...patch })); setError(null); key.current = null; };
  const change = Object.fromEntries((["headline", "message", "description"] as const)
    .filter((field) => words[field].trim() && words[field].trim() !== (current?.words[field] ?? "").trim())
    .map((field) => [field, words[field].trim()]));

  async function save() {
    if (!Object.keys(change).length) { setError(t("editAd.noChange")); return; }
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ads/${adId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, idempotencyKey: key.current }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(data.error ?? t("editAd.failed")); return; }
      onSaved(t("editAd.saved", { backToReview: t("editAd.backToReview") }), { adId, change });
    } catch {
      setError(t("editAd.offline"));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogTitle>{t("editAd.title")}</DialogTitle>
      <DialogDescription>{campaignName}</DialogDescription>
      {ads.length > 1 && <label htmlFor={ids.ad} className="grid gap-1 text-sm font-medium text-slate-800">{t("editAd.ad")}
        <Select id={ids.ad} value={adId} onChange={(event) => pick(event.target.value)}>
          {ads.map((ad) => <option key={ad.adId} value={ad.adId}>{ad.label}</option>)}
        </Select>
      </label>}
      <label htmlFor={ids.headline} className="grid gap-1 text-sm font-medium text-slate-800">{t("editAd.headline")}
        <Input id={ids.headline} value={words.headline} maxLength={255} onChange={(event) => edit({ headline: event.target.value })} />
      </label>
      <label htmlFor={ids.message} className="grid gap-1 text-sm font-medium text-slate-800">{t("editAd.message")}
        {hint && <span className="text-sm font-normal text-slate-600">{hint}</span>}
        <Textarea id={ids.message} value={words.message} rows={5} maxLength={2000} onChange={(event) => edit({ message: event.target.value })} />
      </label>
      <label htmlFor={ids.description} className="grid gap-1 text-sm font-medium text-slate-800">{t("editAd.description")}
        <Input id={ids.description} value={words.description} maxLength={255} onChange={(event) => edit({ description: event.target.value })} />
      </label>
      <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("editAd.backToReview")} {t("editAd.unchanged")}</p>
      {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>{t("editAd.cancel")}</Button></DialogClose>
        <Button type="button" disabled={busy || !adId} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t("editAd.save")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
