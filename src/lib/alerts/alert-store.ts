import type { AlertStore, ClaimResult } from "@/lib/alerts/sender";

/** The service-role RPCs from 20261027_owner_whatsapp_alerts_sends.sql. */
type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

const reasons = new Set(["unverified", "opted_out", "off", "paused", "template_blocked", "cap", "duplicate"]);

export function parseClaim(data: unknown): ClaimResult {
  const row = data as { claimed?: unknown; sendId?: unknown; phone?: unknown; language?: unknown; reason?: unknown } | null;
  if (row?.claimed === true && typeof row.sendId === "number" && typeof row.phone === "string" && /^\+[1-9]\d{6,14}$/.test(row.phone)) {
    return { claimed: true, sendId: row.sendId, phone: row.phone, language: row.language === "hi" ? "hi" : "en" };
  }
  if (row?.claimed === false && typeof row.reason === "string" && reasons.has(row.reason)) return { claimed: false, reason: row.reason as Extract<ClaimResult, { claimed: false }>["reason"] };
  throw new Error("Alert claim returned an unexpected answer.");
}

/** #701: the alert send log, written only through the service-only functions. */
export function supabaseAlertStore(admin: Rpc): AlertStore & { blockTemplate(template: string, category: string): Promise<void> } {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`Alert ${fn} failed.`);
    return data;
  };
  return {
    async claim({ businessId, kind, key, template, monthCap }) {
      return parseClaim(await call("owner_alert_claim", { p_business_id: businessId, p_kind: kind, p_key: key, p_template: template, p_month_cap: monthCap }));
    },
    async settle(sendId, outcome, messageId) {
      await call("owner_alert_settle", { p_send_id: sendId, p_state: outcome.state, p_error_code: outcome.code, p_wa_message_id: messageId, p_counts: outcome.counts });
    },
    async blockTemplate(template, category) {
      await call("owner_alert_template_block", { p_template: template, p_category: category });
    },
  };
}
