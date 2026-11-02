import { setupFieldsFrom } from "@/lib/brand/setup-fields";
import { brandUsable } from "@/lib/brand/usable";
import { madeForSetup } from "@/lib/creative/setup-picks";
import { firstTimer, type LiveSignals, type SetupStep } from "@/lib/setup/steps";
import type { Business, Creative } from "@/lib/types";

/**
 * The first-timer's step and the ads Go live can use; the step is null after a campaign has gone live.
 */
export function setupResume<T extends Pick<Creative, "status" | "generation">>({ business, creatives, campaigns }: {
  business: Pick<Business, "name" | "vertical" | "phone" | "locations" | "offers"> | null;
  creatives: T[];
  campaigns: LiveSignals[];
}): { step: SetupStep | null; ready: T[] } {
  if (!firstTimer(campaigns)) return { step: null, ready: [] };
  if (!business || !brandUsable({ ...business, vertical: setupFieldsFrom(business).vertical })) return { step: 1, ready: [] };
  const ready = creatives.filter((creative) => creative.status === "approved" && madeForSetup(creative, business));
  return { step: ready.length ? 3 : 2, ready };
}
