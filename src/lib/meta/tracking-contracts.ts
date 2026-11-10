import { z } from "zod";
import { selectedAssetsSchema } from "./connect-contracts";
import type { TrackingStatus } from "./pixels";

const pixelId = z.string().regex(/^\d{1,32}$/);
const time = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative().safe();

export const trackingStatusSchema: z.ZodType<TrackingStatus> = z.object({
  state: z.enum(["none", "unreadable", "quiet", "event_missing", "ready"]),
  unreadable: z.enum(["reconnect", "throttled", "list_failed", "not_listed", "unavailable", "stats_failed", "stats_incomplete"]).nullable(),
  pixelId: pixelId.nullable(),
  pixels: z.array(z.object({
    id: pixelId,
    name: z.string().max(1_000),
    lastFiredAt: time.nullable(),
    unavailable: z.boolean(),
  })).max(500),
  window: z.object({ since: time, until: time })
    .refine(({ since, until }) => Date.parse(since) <= Date.parse(until)).nullable(),
  lastSeenAt: time.nullable(),
  counts: z.object({ Lead: count, Purchase: count }).nullable(),
  totalEvents: count.nullable(),
}).refine((status) => {
  const { state, unreadable, pixelId: checkedPixel, pixels, window, lastSeenAt, counts, totalEvents } = status;
  const anyStats = window !== null || counts !== null || totalEvents !== null;
  if (anyStats && (!window || !counts || totalEvents === null || counts.Lead + counts.Purchase > totalEvents)) return false;
  if (state === "unreadable") return unreadable !== null;
  if (unreadable !== null) return false;
  if (state === "none") return checkedPixel === null && pixels.length === 0 && !anyStats && lastSeenAt === null;
  if (!checkedPixel || !pixels.some((pixel) => pixel.id === checkedPixel && !pixel.unavailable) || !counts || totalEvents === null || !window) return false;
  if (state === "quiet") return totalEvents === 0;
  if (state === "ready") return counts.Lead + counts.Purchase > 0;
  return totalEvents > 0;
}, { message: "Contradictory tracking status." });

export const accountTrackingDtoSchema = z.object({
  businessId: z.uuid(),
  connectionGeneration: z.number().int().nonnegative().safe(),
  binding: selectedAssetsSchema.pick({ adAccountId: true, pageId: true }),
  status: trackingStatusSchema,
});
export type AccountTrackingDTO = z.infer<typeof accountTrackingDtoSchema>;
