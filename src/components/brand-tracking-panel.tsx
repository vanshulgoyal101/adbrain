"use client";

import { BrandTrackingCard } from "@/components/brand-tracking-card";
import { refreshBrandTracking } from "@/app/(app)/brand/actions";
import { websiteTrackingCopy } from "@/i18n/website-tracking";
import type { Words } from "@/i18n/words";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";

export function BrandTrackingPanel({ tracking, words }: {
  tracking: ReviewTracking;
  words: Words<"websiteTracking">;
}) {
  return (
    <BrandTrackingCard
      tracking={tracking}
      copy={websiteTrackingCopy(words).card}
      onCheckAgain={refreshBrandTracking}
    />
  );
}
