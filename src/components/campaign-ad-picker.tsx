"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChooseAds, type ChoosableAd } from "@/components/choose-ads";
import { LivePicture, type PicturePreview } from "@/components/live-picture";
import { PickerAdTile } from "@/components/picker-ad-tile";
import { campaignsTranslator, type Words } from "@/i18n/words";
import type { Creative } from "@/lib/types";

const PHONE_PICKER_ADS = 6;

export function CampaignAdPicker({ ads, selected, dailyBudgetInr, videoAssetIds, words, editingAdId, adPicture, hasPlacedError, hasPilotLimitError, onSelectionChange, onEditAd }: {
  ads: Creative[];
  selected: string[];
  dailyBudgetInr: number;
  videoAssetIds: string[];
  words?: Words<"campaigns">;
  editingAdId: string | null;
  adPicture: PicturePreview | null;
  hasPlacedError: boolean;
  hasPilotLimitError: boolean;
  onSelectionChange: (ids: string[]) => void;
  onEditAd: (id: string) => void;
}) {
  const t = campaignsTranslator(words);
  const [showAllAds, setShowAllAds] = useState(false);
  const selectedIds = new Set(selected);
  const adsById = new Map(ads.map((ad) => [ad.id, ad]));
  const chooserAds: ChoosableAd[] = ads.map((ad) => ({
    id: ad.id,
    kind: ad.media_asset_id ? videoAssetIds.includes(ad.media_asset_id) ? "video" : "photo" : "adbrain",
    imageUrl: ad.image_url,
    title: ad.headline?.trim() || t("picker.thisAd"),
  }));
  const describedBy = [
    hasPlacedError ? "ads-error" : null,
    hasPilotLimitError ? "pilot-limit-error" : null,
  ].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <div id="campaign-ad-picker" className="mt-2">
        <ChooseAds
          ads={chooserAds}
          selected={selected}
          maxAds={null}
          dailyBudgetInr={dailyBudgetInr}
          words={words}
          onSelectionChange={onSelectionChange}
          itemClassName={(_ad, isSelected, index) =>
            !showAllAds && index >= PHONE_PICKER_ADS && !isSelected ? "max-sm:hidden" : undefined}
          renderAd={(choice, isSelected, onToggle) => {
            const ad = adsById.get(choice.id);
            if (!ad) return null;
            return <PickerAdTile
              ad={ad}
              selected={isSelected}
              editing={editingAdId === ad.id}
              describedBy={describedBy}
              labels={{
                yours: videoAssetIds.includes(ad.media_asset_id ?? "") ? t("picker.yourVideo") : t("picker.yourPhoto"),
                select: t("picker.selectAd"),
                preview: t("picker.adPreview"),
                edit: t("picker.edit"),
                editAd: (headline) => t("picker.editAd", { headline: headline || t("picker.thisAd") }),
              }}
              livePicture={ad.id === editingAdId && adPicture ? <LivePicture preview={adPicture} /> : null}
              onToggle={onToggle}
              onEdit={() => onEditAd(ad.id)}
            />;
          }}
        />
      </div>
      {!showAllAds && ads.some((ad, index) => index >= PHONE_PICKER_ADS && !selectedIds.has(ad.id)) && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowAllAds(true)} className="mt-2 h-11 w-full sm:hidden">
          Show all {ads.length} ads
        </Button>
      )}
    </>
  );
}
