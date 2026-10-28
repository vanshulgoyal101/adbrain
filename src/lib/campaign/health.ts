import { z } from "zod";
import type { AdReview } from "@/lib/meta/client";

const HEALTH_KINDS = ["rejected", "not_delivering", "ended"] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

/** An active run with zero impressions for this long is flagged (#258). */
const NOT_DELIVERING_AFTER_MS = 6 * 3_600_000;
// A gap longer than this between checks means the run was paused or unchecked, so its clock restarts.
const CONTINUOUS_CHECK_MS = 2 * 3_600_000;

const flagSchema = z.object({
  kind: z.enum(HEALTH_KINDS),
  reason: z.string().min(1).max(400),
  since: z.iso.datetime(),
  key: z.string().regex(/^[a-f0-9]{12}$/),
});
export const campaignHealthSchema = z.object({
  checkedAt: z.iso.datetime(),
  activeSince: z.iso.datetime(),
  flags: z.array(flagSchema).max(HEALTH_KINDS.length),
});
export type CampaignHealth = z.infer<typeof campaignHealthSchema>;
export type HealthFlag = CampaignHealth["flags"][number];

const capSchema = z.object({ cap: z.object({ endTime: z.iso.datetime({ offset: true }), days: z.number().int().positive() }) });

export function readCampaignHealth(raw: unknown): CampaignHealth | null {
  const parsed = z.object({ health: campaignHealthSchema }).safeParse(raw);
  return parsed.success ? parsed.data.health : null;
}

/**
 * Health of an active campaign from one read-only Meta check (#258). A failed ad review read
 * (`review: null`) keeps the previous rejection flag instead of clearing it. `key` names one
 * occurrence of a problem for alerts without exposing any identifier.
 */
export function assessCampaignHealth(input: {
  raw: unknown; now: Date; impressions: number; review: AdReview[] | null;
  key: (kind: HealthKind, since: string) => string;
}): CampaignHealth {
  const now = input.now.getTime();
  const previous = readCampaignHealth(input.raw);
  const continuous = previous !== null && now - Date.parse(previous.checkedAt) <= CONTINUOUS_CHECK_MS;
  const cap = capSchema.safeParse(input.raw);
  const capEnd = cap.success ? Date.parse(cap.data.cap.endTime) : null;
  const capStart = cap.success ? capEnd! - cap.data.cap.days * 86_400_000 : null;
  let activeSince = continuous ? Date.parse(previous.activeSince) : now;
  // The current capped run's start is known exactly; a newer capped run restarts the clock.
  if (capStart !== null && capEnd! > now && capStart <= now && (!continuous || capStart > activeSince)) activeSince = capStart;

  const found: Array<{ kind: HealthKind; reason: string }> = [];
  const flagged = input.review?.filter(ad => ad.state === "rejected" || ad.state === "issues") ?? [];
  if (flagged.length) {
    const reasons = [...new Set(flagged.flatMap(ad => ad.reasons))].join("; ");
    const what = flagged.some(ad => ad.state === "rejected") ? "Meta rejected" : "Meta flagged issues on";
    found.push({ kind: "rejected", reason: `${what} ${flagged.length === 1 ? "an ad" : `${flagged.length} ads`}${reasons ? `: ${reasons}` : "."}`.slice(0, 400) });
  } else if (input.review === null) {
    const kept = previous?.flags.find(flag => flag.kind === "rejected");
    if (kept) found.push(kept);
  }
  if (input.impressions === 0 && now - activeSince >= NOT_DELIVERING_AFTER_MS) {
    found.push({ kind: "not_delivering", reason: "No impressions after 6 hours of running. Check the ads and audience in Meta." });
  }
  if (capEnd !== null && capEnd <= now) {
    found.push({ kind: "ended", reason: "This run's end date has passed. Pause it, or start a new run." });
  }

  const flags = found.map(({ kind, reason }) => {
    const earlier = previous?.flags.find(flag => flag.kind === kind);
    const since = earlier?.since ?? input.now.toISOString();
    return { kind, reason, since, key: earlier?.key ?? input.key(kind, since) };
  });
  return { checkedAt: input.now.toISOString(), activeSince: new Date(activeSince).toISOString(), flags };
}

/** "Needs attention" text for an active campaign, or null (#258). */
export function campaignAttention(campaign: { status: string; raw: unknown }): string | null {
  if (campaign.status !== "active") return null;
  const flags = readCampaignHealth(campaign.raw)?.flags ?? [];
  return flags.length ? flags.map(flag => flag.reason).join(" ") : null;
}
