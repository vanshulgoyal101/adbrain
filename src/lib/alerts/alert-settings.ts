import { maskWhatsAppNumber } from "@/lib/meta/whatsapp-status-shared";
import type { OwnerAlertPrefsRow } from "@/lib/types";

/** What Settings shows about one business's WhatsApp alerts; the number leaves the server masked only. */
export type AlertSettings = {
  leadAlerts: boolean;
  dailyResults: boolean;
  language: "en" | "hi";
  /** "+91 ••••• 0001" once the owner sent START from it. */
  number: string | null;
  optedOut: boolean;
  /** #1720: the owner has saved alert settings; until then the panel offers the defaults. */
  saved?: boolean;
};

export function alertSettingsFrom(row: Pick<OwnerAlertPrefsRow, "lead_alerts" | "daily_results" | "language" | "phone_e164" | "verified_at" | "opted_out_at"> | null): AlertSettings {
  return {
    leadAlerts: row?.lead_alerts ?? false, dailyResults: row?.daily_results ?? false, language: row?.language ?? "en",
    number: row?.verified_at && row.phone_e164 ? maskWhatsAppNumber(row.phone_e164) : null,
    optedOut: Boolean(row?.opted_out_at),
    saved: Boolean(row),
  };
}
