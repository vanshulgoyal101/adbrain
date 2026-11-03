import type { SupabaseClient } from "@supabase/supabase-js";
import { savedGenerationSettings } from "@/lib/creative/receipt";
import type { WhatsAppOpening } from "@/lib/meta/client";

/** #789: a media library asset (#1209's `media_assets`) an ad was made from. */
export type CreativeMedia = { id: string; kind: string; source: string };

type Generation = { textModels?: { model?: unknown }[]; image?: { model?: unknown } } | null;

export type LaunchSnapshotInput = {
  destination: string;
  objective: string;
  dailyBudgetRupees: number;
  adSetCount: number;
  abTest: boolean;
  areas: string[];
  ageMin: number | undefined;
  ageMax: number | undefined;
  gender: string;
  interests: string[];
  whatsappLanguage: string | null;
  prefill: WhatsAppOpening | null;
  /** #840: this campaign's edited WhatsApp message, the business's saved one, or AdBrain's suggestion. */
  prefillSource?: "edited" | "saved" | "suggested";
  storyFormat: boolean;
  /** #789: `media` is the library photo or video the ad was made from (`readCreativeMedia`), if any. */
  creatives: { id: string; angle: string | null; generation: unknown; media?: CreativeMedia | null }[];
  /** #789: when the media read began, set only if it failed or timed out: a null `mediaAssetId` then means unknown, not "no photo". */
  mediaUnknownAt?: string;
  /** #672: the ad sets' `targeting` forms as sent to Meta (from the plan check's payloads). */
  sentTargetings?: string[];
  /** #672: the Meta creative each ad runs on, in ad order. */
  metaCreativeIds?: string[];
};

/** #906: the placements Meta was sent: automatic everywhere, or automatic within named platforms (WhatsApp leaves Audience Network out; #2273 also Facebook Reels). */
function sentPlacements(targetings: string[] | undefined): string {
  const platforms = new Set((targetings ?? []).map((form) => {
    try {
      const { publisher_platforms: value, facebook_positions: facebook } = JSON.parse(form) as { publisher_platforms?: unknown; facebook_positions?: unknown };
      // #2273: the no-Reels test is its own arm in the ledger.
      const noReels = Array.isArray(facebook) && !facebook.includes("facebook_reels") ? " -facebook_reels" : "";
      return Array.isArray(value) ? `${value.join(",")}${noReels}` : "advantage";
    } catch {
      return "unknown";
    }
  }));
  if (!platforms.size) return "advantage";
  return platforms.size === 1 ? ([...platforms][0] === "advantage" ? "advantage" : `advantage:${[...platforms][0]}`) : "mixed";
}

/** The advantage_audience Meta was sent: 1 or 0 when every ad set agrees, null when unknown or mixed. */
function sentAdvantageAudience(targetings: string[] | undefined): number | null {
  const values = new Set((targetings ?? []).map((form) => {
    try {
      const value = (JSON.parse(form) as { targeting_automation?: { advantage_audience?: unknown } }).targeting_automation?.advantage_audience;
      return value === 0 || value === 1 ? value : null;
    } catch {
      return null;
    }
  }));
  return values.size === 1 ? [...values][0] : null;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * #588: what this launch tried, so runs can be compared (e.g. #157's Hinglish prefill vs #499's
 * English one). Settings, short public text and IDs only: never a lead's data. Version it so later
 * fields can be added without guessing.
 */
export function buildLaunchSnapshot(input: LaunchSnapshotInput) {
  return {
    // v2 (#672): Advantage+ as sent, Meta creative ids, and `cap` once a capped run is activated.
    // v3 (#789): each creative's library asset (`mediaAssetId`) and the distinct assets in `media`.
    version: 3,
    destination: input.destination,
    objective: input.objective,
    budget: { dailyRupees: input.dailyBudgetRupees, adSets: input.adSetCount, abTest: input.abTest },
    audience: {
      areas: input.areas,
      ageMin: input.ageMin ?? null,
      ageMax: input.ageMax ?? null,
      gender: input.gender,
      interests: input.interests,
      advantageAudience: sentAdvantageAudience(input.sentTargetings),
    },
    placements: sentPlacements(input.sentTargetings),
    formats: input.storyFormat ? ["4:5", "9:16"] : ["4:5"],
    whatsapp: input.prefill ? {
      language: input.whatsappLanguage ?? "ad", prefill: input.prefill.autofill, greeting: input.prefill.greeting,
      button: input.prefill.iceBreakers?.length ? "ice_breakers" : input.prefill.callButton ? "call" : "none",
      ...(input.prefill.iceBreakers?.length ? { iceBreakers: input.prefill.iceBreakers } : {}),
      source: input.prefillSource ?? "suggested",
    } : null,
    creatives: input.creatives.map((creative) => {
      const generation = (creative.generation && typeof creative.generation === "object" ? creative.generation : null) as Generation;
      return {
        id: creative.id,
        angle: creative.angle,
        language: savedGenerationSettings(creative.generation).language ?? null,
        textModel: text(generation?.textModels?.[0]?.model),
        imageModel: text(generation?.image?.model),
        mediaAssetId: creative.media?.id ?? null,
      };
    }),
    media: [...new Map(input.creatives.flatMap(({ media }) => media ? [[media.id, { mediaAssetId: media.id, kind: media.kind, source: media.source }] as const] : [])).values()],
    metaCreativeIds: input.metaCreativeIds ?? [],
    ...(input.mediaUnknownAt ? { mediaUnknownAt: input.mediaUnknownAt } : {}),
    cap: null as null | { lifetimeRupees: number; days: number; endTime: string },
  };
}

/**
 * #789: the library asset each creative was made from, for the ledger. Best effort like the ledger itself:
 * any error or a read slower than 1.5 s (including a database without #2625's `media_asset_id` yet) gives
 * `null` (unknown, distinct from an empty map meaning no photos), never a failed launch.
 * QA #2753: also unknown when a linked photo is missing from the read, or when a creative changed (its `updated_at`,
 * stamped by every update) since `readAt`, the read whose image Meta was sent, so a relink is never recorded as sent.
 */
export async function readCreativeMedia(
  database: SupabaseClient, businessId: string, creativeIds: string[],
  options: { readAt?: ReadonlyMap<string, string>; timeoutMs?: number } = {},
): Promise<Map<string, CreativeMedia> | null> {
  // Launch awaits this after Meta's create and before the campaign row is saved, so a stalled read must not hold it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), options.timeoutMs ?? MEDIA_READ_TIMEOUT_MS); });
  try {
    return await Promise.race([lookupCreativeMedia(database, businessId, creativeIds, options.readAt), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const MEDIA_READ_TIMEOUT_MS = 1500;

async function lookupCreativeMedia(database: SupabaseClient, businessId: string, creativeIds: string[], readAt?: ReadonlyMap<string, string>): Promise<Map<string, CreativeMedia> | null> {
  const media = new Map<string, CreativeMedia>();
  try {
    if (!creativeIds.length) return media;
    const { data: links, error } = await database.from("creatives").select("id, media_asset_id, updated_at").in("id", creativeIds).eq("business_id", businessId);
    if (error || !Array.isArray(links)) return null;
    const rows = links as { id: string; media_asset_id: string | null; updated_at?: string | null }[];
    if (readAt && [...readAt].some(([id, at]) => {
      const row = rows.find(link => link.id === id);
      return !row?.updated_at || Date.parse(row.updated_at) !== Date.parse(at);
    })) return null;
    const linked = rows.filter(link => link.media_asset_id);
    if (!linked.length) return media;
    const { data: assets, error: assetError } = await database.from("media_assets").select("id, kind, source")
      .in("id", [...new Set(linked.map(link => link.media_asset_id!))]).eq("business_id", businessId);
    if (assetError || !Array.isArray(assets)) return null;
    const byId = new Map((assets as CreativeMedia[]).map(asset => [asset.id, { id: asset.id, kind: asset.kind, source: asset.source }]));
    for (const link of linked) {
      const asset = byId.get(link.media_asset_id!);
      if (!asset) return null;
      media.set(link.id, asset);
    }
    return media;
  } catch {
    return null;
  }
}

/**
 * #672: on a confirmed capped activation, add the cap to the run's snapshot. Best effort, like
 * saving the snapshot: activation never fails because the ledger couldn't be updated.
 */
export async function recordLaunchCap(database: SupabaseClient, row: { campaignId: string; cap: { lifetimeBudgetPaise: number; days: number; endTime: string } }): Promise<boolean> {
  try {
    const { data, error } = await database.from("campaign_learnings").select("snapshot").eq("campaign_id", row.campaignId).maybeSingle();
    if (error || !data || !data.snapshot || typeof data.snapshot !== "object" || Array.isArray(data.snapshot)) return false;
    const cap = { lifetimeRupees: row.cap.lifetimeBudgetPaise / 100, days: row.cap.days, endTime: row.cap.endTime };
    const { error: updateError } = await database.from("campaign_learnings")
      .update({ snapshot: { ...data.snapshot, cap }, updated_at: new Date().toISOString() }).eq("campaign_id", row.campaignId);
    return !updateError;
  } catch {
    return false;
  }
}

/** Best effort: a launch never fails because its ledger row couldn't be written. */
export async function saveLaunchSnapshot(database: SupabaseClient, row: { campaignId: string; businessId: string; snapshot: object }): Promise<boolean> {
  try {
    const { error } = await database.from("campaign_learnings")
      .upsert({ campaign_id: row.campaignId, business_id: row.businessId, snapshot: row.snapshot }, { onConflict: "campaign_id" });
    return !error;
  } catch {
    return false;
  }
}
