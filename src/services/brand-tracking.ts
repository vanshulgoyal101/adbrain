import type { ReviewTracking } from "@/lib/campaign/website-tracking";
import { readTrackingStatusForBusiness } from "@/lib/meta/credentials";

export async function readBrandTrackingStatus(businessId: string, pixelId?: string): Promise<ReviewTracking | null> {
  const status = await readTrackingStatusForBusiness(businessId, pixelId);
  return status ? { pixelId: status.pixelId, status } : null;
}
