import "server-only";

import { z } from "zod";
import { getEnv } from "@/lib/env";

const uuid = z.string().uuid();

/** Only call with a business ID already authorized for the current actor. */
export function mediaPilotEnabled(authorizedBusinessId: string): boolean {
  const { MEDIA_UPLOADS_ENABLED, MEDIA_PILOT_BUSINESS_IDS } = getEnv();
  if (!MEDIA_UPLOADS_ENABLED || !MEDIA_PILOT_BUSINESS_IDS.trim()) return false;
  const businesses = MEDIA_PILOT_BUSINESS_IDS.split(",").map((id) => id.trim());
  if (businesses.some((id) => !uuid.safeParse(id).success)) {
    console.error("Media pilot configuration contains an invalid business ID; the pilot is disabled.");
    return false;
  }
  return uuid.safeParse(authorizedBusinessId).success
    && businesses.some((id) => id.toLowerCase() === authorizedBusinessId.toLowerCase());
}
