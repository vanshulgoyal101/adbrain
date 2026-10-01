import { createClient } from "@/lib/supabase/server";
import { advisoryPreferenceContext, type AdvisoryPreference, type PreferenceTask } from "@/lib/preferences/context";

export interface PreferenceState {
  enabled: boolean;
  epoch: number;
  notes: (AdvisoryPreference & { version: number })[];
}

export async function readPreferenceState(businessId: string): Promise<PreferenceState> {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error("Unauthorized");
  const { data: settings, error: settingsError } = await client.from("preference_settings")
    .select("enabled, epoch").eq("business_id", businessId).eq("owner_id", user.id).maybeSingle();
  if (settingsError) throw settingsError;
  if (!settings) return { enabled: false, epoch: 0, notes: [] };
  const { data: notes, error: notesError } = await client.from("declared_preferences")
    .select("category, value, version, updated_at").eq("business_id", businessId).eq("owner_id", user.id)
    .order("updated_at", { ascending: false }).limit(12);
  if (notesError) throw notesError;
  const { data: current, error: currentError } = await client.from("preference_settings")
    .select("enabled, epoch").eq("business_id", businessId).eq("owner_id", user.id).maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.epoch !== settings.epoch) throw new Error("Preferences changed while reading.");
  return { enabled: current.enabled, epoch: current.epoch, notes: (notes ?? []) as PreferenceState["notes"] };
}

export async function preferenceContext(businessId: string, task: PreferenceTask, request: string): Promise<string> {
  try {
    const state = await readPreferenceState(businessId);
    return state.enabled ? advisoryPreferenceContext(state.notes, task, request) : "";
  } catch {
    return "";
  }
}