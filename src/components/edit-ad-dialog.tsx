"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BACK_TO_REVIEW, editableAds } from "@/lib/campaign/ad-edit-copy";
import { savedCreativeDescription } from "@/lib/creative/concept";
import type { Campaign, Creative } from "@/lib/types";

type Words = { headline: string; message: string; description: string };

/**
 * #775: change the words on a launched ad. Saving makes a new version on Meta and the ad goes back
 * to review; the picture, audience and budget don't change.
 */
export function EditAdDialog({ campaign, campaignName, creatives, onClose, onSaved }: {
  campaign: Pick<Campaign, "id" | "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw" | "creative_ids">;
  campaignName: string;
  creatives: Creative[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const campaignId = campaign.id;
  const ads = React.useMemo(() => editableAds(campaign, campaign.creative_ids ?? []).map((ad) => {
    const creative = creatives.find((item) => item.id === ad.creativeId);
    const words: Words = { headline: creative?.headline ?? "", message: creative?.primary_text ?? "", description: savedCreativeDescription(creative?.generation) ?? "" };
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
    if (!Object.keys(change).length) { setError("Change the headline, text or description first."); return; }
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ads/${adId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, idempotencyKey: key.current }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(data.error ?? "Couldn't change the ad. Nothing changed."); return; }
      onSaved(`New words saved. ${BACK_TO_REVIEW}`);
    } catch {
      setError("No connection. Nothing changed; try again.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogTitle>Edit ad words</DialogTitle>
      <DialogDescription>{campaignName}</DialogDescription>
      {ads.length > 1 && <label htmlFor={ids.ad} className="grid gap-1 text-sm font-medium text-slate-800">Ad
        <Select id={ids.ad} value={adId} onChange={(event) => pick(event.target.value)}>
          {ads.map((ad) => <option key={ad.adId} value={ad.adId}>{ad.label}</option>)}
        </Select>
      </label>}
      <label htmlFor={ids.headline} className="grid gap-1 text-sm font-medium text-slate-800">Headline
        <Input id={ids.headline} value={words.headline} maxLength={255} onChange={(event) => edit({ headline: event.target.value })} />
      </label>
      <label htmlFor={ids.message} className="grid gap-1 text-sm font-medium text-slate-800">Ad text
        <Textarea id={ids.message} value={words.message} rows={5} maxLength={2000} onChange={(event) => edit({ message: event.target.value })} />
      </label>
      <label htmlFor={ids.description} className="grid gap-1 text-sm font-medium text-slate-800">Description
        <Input id={ids.description} value={words.description} maxLength={255} onChange={(event) => edit({ description: event.target.value })} />
      </label>
      <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{BACK_TO_REVIEW} The picture, audience and budget don&apos;t change.</p>
      {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
        <Button type="button" disabled={busy || !adId} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Save and send to review</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
