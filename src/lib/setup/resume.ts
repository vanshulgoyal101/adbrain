import { setupFieldsFrom } from "@/lib/brand/setup-fields";
import { brandUsable } from "@/lib/brand/usable";
import { firstTimer, type SetupStep } from "@/lib/setup/steps";
import type { Business } from "@/lib/types";

/**
 * #1272 (#1251 WS1 slice 5): the setup step a first-timer resumes at, or null once a campaign has gone live
 * (normal Home). 1 until the five facts make a usable Brand, 2 until an ad is picked (approved), then 3.
 */
export function setupResumeStep({ business, creatives, campaigns }: {
  business: Pick<Business, "name" | "vertical" | "phone" | "locations" | "offers"> | null;
  creatives: { status: string }[];
  campaigns: { launched_at: string | null; status?: string }[];
}): SetupStep | null {
  if (!firstTimer(campaigns)) return null;
  if (!business || !brandUsable({ ...business, vertical: setupFieldsFrom(business).vertical })) return 1;
  if (!creatives.some((creative) => creative.status === "approved")) return 2;
  return 3;
}
