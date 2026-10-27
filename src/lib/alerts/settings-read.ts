import { getEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { alertSettingsFrom, type AlertSettings } from "./alert-settings";

/** #701: null hides the card (no alerts number configured, or the table isn't there yet). */
export async function readAlertSettings(businessId: string): Promise<AlertSettings | null> {
  if (!getEnv().ALERTS_WHATSAPP) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("owner_alert_prefs")
    .select("lead_alerts, daily_results, language, phone_e164, verified_at, opted_out_at").eq("business_id", businessId).maybeSingle();
  return error ? null : alertSettingsFrom(data);
}
