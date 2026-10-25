import type { SupabaseClient } from "@supabase/supabase-js";
import { ADVANTAGE_AUDIENCE } from "@/lib/meta/client";
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
};

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * #588: what this launch tried, so runs can be compared (e.g. #157's Hinglish prefill vs #499's
 * English one). Settings, short public text and IDs only: never a lead's data. Version it so later
 * fields can be added without guessing.
 */
export function buildLaunchSnapshot(input: LaunchSnapshotInput) {
  return {
    version: 1,
    destination: input.destination,
    objective: input.objective,
    budget: { dailyRupees: input.dailyBudgetRupees, adSets: input.adSetCount, abTest: input.abTest },
    audience: {
      areas: input.areas,
      ageMin: input.ageMin ?? null,
      ageMax: input.ageMax ?? null,
      gender: input.gender,
      interests: input.interests,
      advantageAudience: ADVANTAGE_AUDIENCE,
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
  };
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
