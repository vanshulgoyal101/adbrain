import type { SupabaseClient } from "@supabase/supabase-js";
import { savedGenerationSettings } from "@/lib/creative/receipt";
import type { WhatsAppGreeting } from "./whatsapp-greeting";

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
  prefill: WhatsAppGreeting | null;
  storyFormat: boolean;
  creatives: { id: string; angle: string | null; generation: unknown }[];
  /** #672: the ad sets' `targeting` forms as sent to Meta (from the plan check's payloads). */
  sentTargetings?: string[];
  /** #672: the Meta creative each ad runs on, in ad order. */
  metaCreativeIds?: string[];
};

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
    version: 2,
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
    placements: "advantage",
    formats: input.storyFormat ? ["4:5", "9:16"] : ["4:5"],
    whatsapp: input.prefill ? { language: input.whatsappLanguage ?? "ad", prefill: input.prefill.autofill, greeting: input.prefill.greeting } : null,
    creatives: input.creatives.map((creative) => {
      const generation = (creative.generation && typeof creative.generation === "object" ? creative.generation : null) as Generation;
      return {
        id: creative.id,
        angle: creative.angle,
        language: savedGenerationSettings(creative.generation).language ?? null,
        textModel: text(generation?.textModels?.[0]?.model),
        imageModel: text(generation?.image?.model),
      };
    }),
    metaCreativeIds: input.metaCreativeIds ?? [],
    cap: null as null | { lifetimeRupees: number; days: number; endTime: string },
  };
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
