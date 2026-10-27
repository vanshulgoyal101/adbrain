"use server";

import { z } from "zod";
import { getEnv } from "@/lib/env";
import { observeAction } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { alertStartLink } from "@/lib/alerts/owner-alerts";
import { alertSettingsFrom, type AlertSettings } from "@/lib/alerts/alert-settings";

const saveSchema = z.object({ businessId: z.uuid(), leadAlerts: z.boolean(), dailyResults: z.boolean(), language: z.enum(["en", "hi"]) }).strict();

export async function saveAlertSettings(input: z.input<typeof saveSchema>): Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }> {
  return observeAction("server.saveAlertSettings", async () => {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid alert settings." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("owner_alert_prefs_set", {
      p_business_id: parsed.data.businessId, p_lead_alerts: parsed.data.leadAlerts, p_daily_results: parsed.data.dailyResults, p_language: parsed.data.language,
    });
    if (error || !data) return { ok: false, error: error?.code === "42501" ? "Business unavailable." : "Couldn't save your alert settings. Try again." };
    return { ok: true, settings: alertSettingsFrom(data) };
  });
}

/** A fresh "START <code>" link to AdBrain's alerts number; the owner sends it from the WhatsApp that should get alerts. */
export async function startAlertVerification(input: { businessId: string }): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  return observeAction("server.startAlertVerification", async () => {
    if (!z.uuid().safeParse(input.businessId).success) return { ok: false, error: "Invalid business." };
    const alertsNumber = getEnv().ALERTS_WHATSAPP;
    if (!alertsNumber) return { ok: false, error: "WhatsApp alerts aren't available yet." };
    const supabase = await createClient();
    const { data: code, error } = await supabase.rpc("owner_alert_start_verification", { p_business_id: input.businessId });
    const link = code ? alertStartLink(alertsNumber, code) : null;
    if (error || !link) return { ok: false, error: "Couldn't start the confirmation. Try again." };
    return { ok: true, link };
  });
}
