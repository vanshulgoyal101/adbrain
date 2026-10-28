import { describe, expect, it, vi } from "vitest";
import { ALERT_MONTH_CAP, answersLine, classifySendFailure, deliverOwnerAlert, ownerAlertsConfig, recategorisedTemplates, sendTemplate, templateText, WhatsAppSendError, type AlertStore, type ClaimResult } from "@/lib/alerts/sender";
import { parseClaim, supabaseAlertStore } from "@/lib/alerts/alert-store";

// Meta's documented Cloud API error bodies (developers.facebook.com, WhatsApp Cloud API error codes).
const metaError = (code: number, message: string, status = 400) => Response.json({
  error: { message, type: "OAuthException", code, error_data: { messaging_product: "whatsapp", details: message }, fbtrace_id: "Atrace" },
}, { status });
const UNDELIVERABLE = () => metaError(131026, "(#131026) Message Undeliverable.");
const TEMPLATE_PARAMS = () => metaError(132018, "(#132018) There was an issue with the parameters in your template.");
const REENGAGEMENT = () => metaError(131047, "(#131047) Re-engagement message");
const RATE_LIMIT = () => metaError(130429, "(#130429) Rate limit hit");
const ACCEPTED = () => Response.json({ messaging_product: "whatsapp", contacts: [{ input: "919800000009", wa_id: "919800000009" }], messages: [{ id: "wamid.HBgM" }] });

const env = { OWNER_ALERTS_ENABLED: "true", ALERTS_WHATSAPP_PHONE_ID: "106540352242922", ALERTS_WHATSAPP_TOKEN: "t" };
const config = ownerAlertsConfig(env)!;

function store(claim: ClaimResult = { claimed: true, sendId: 7, phone: "+919800000009", language: "hi" }) {
  const settle = vi.fn<AlertStore["settle"]>(async () => undefined);
  const claimFn = vi.fn<AlertStore["claim"]>(async () => claim);
  return { store: { claim: claimFn, settle }, claim: claimFn, settle };
}
const alert = { businessId: "b1", kind: "lead" as const, key: "lead-1", params: (language: string) => [language === "hi" ? "नाम" : "Name", "+91 98000 00009", "City: Mohali"] };

describe("owner WhatsApp alert sender (#701 slice 2)", () => {
  it("stays off unless OWNER_ALERTS_ENABLED is exactly true and the number id and token are set", async () => {
    expect(ownerAlertsConfig({})).toBeNull();
    expect(ownerAlertsConfig({ ...env, OWNER_ALERTS_ENABLED: "1" })).toBeNull();
    expect(ownerAlertsConfig({ ...env, ALERTS_WHATSAPP_PHONE_ID: "+91 98000" })).toBeNull();
    expect(config.templates).toEqual({ lead: "adbrain_lead_alert", daily: "adbrain_daily_results" });
    const { store: s, claim } = store();
    expect(await deliverOwnerAlert({ store: s, config: null }, alert)).toEqual({ delivered: false, reason: "disabled" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("sends the template in the owner's language with one-line parameters and records Meta's message id", async () => {
    const { store: s, claim, settle } = store();
    const fetchImpl = vi.fn<typeof fetch>(async () => ACCEPTED());
    expect(await deliverOwnerAlert({ store: s, config, fetchImpl }, alert)).toEqual({ delivered: true, reason: "sent" });
    expect(claim).toHaveBeenCalledWith({ businessId: "b1", kind: "lead", key: "lead-1", template: "adbrain_lead_alert", monthCap: ALERT_MONTH_CAP });
    // QA on #1065: the SQL cap counts every business's sends, so it is the platform guard (CPO §1), not per owner.
    expect(ALERT_MONTH_CAP).toBe(4000);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/106540352242922/messages");
    expect(JSON.parse(String(init!.body))).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: "919800000009", type: "template",
      template: { name: "adbrain_lead_alert", language: { code: "hi" }, components: [{ type: "body", parameters: [{ type: "text", text: "नाम" }, { type: "text", text: "+91 98000 00009" }, { type: "text", text: "City: Mohali" }] }] },
    });
    expect(settle).toHaveBeenCalledWith(7, { state: "sent", counts: false, code: null }, "wamid.HBgM");
  });

  it("sends nothing when the claim is refused (duplicate lead, cap, paused, STOP, blocked template)", async () => {
    for (const reason of ["duplicate", "cap", "paused", "opted_out", "template_blocked", "off", "unverified"] as const) {
      const { store: s, settle } = store({ claimed: false, reason });
      const fetchImpl = vi.fn<typeof fetch>();
      expect(await deliverOwnerAlert({ store: s, config, fetchImpl }, alert)).toEqual({ delivered: false, reason });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    }
  });

  it("maps Meta's error contracts: 131026 counts toward the pause; 132018 and 131047 are ours; 130429 retries", async () => {
    const cases: [() => Response, object][] = [
      [UNDELIVERABLE, { state: "failed", counts: true, code: "131026" }],
      [TEMPLATE_PARAMS, { state: "failed", counts: false, code: "132018" }],
      [REENGAGEMENT, { state: "failed", counts: false, code: "131047" }],
      [RATE_LIMIT, { state: "retry", counts: false, code: "130429" }],
      [() => new Response("<html>", { status: 502 }), { state: "retry", counts: false, code: "http.502" }],
      [() => Response.json({ messages: [] }), { state: "failed", counts: false, code: "http.200" }],
    ];
    for (const [answer, outcome] of cases) {
      const { store: s, settle } = store();
      await deliverOwnerAlert({ store: s, config, fetchImpl: async () => answer() }, alert);
      expect(settle).toHaveBeenCalledWith(7, outcome, null);
    }
  });

  it("never resends a send that timed out or lost its connection: it may have been delivered", async () => {
    for (const [thrown, code] of [[new DOMException("The operation timed out.", "TimeoutError"), "timeout"], [new TypeError("fetch failed"), "network"]] as const) {
      const { store: s, settle } = store();
      await deliverOwnerAlert({ store: s, config, fetchImpl: async () => { throw thrown; } }, alert);
      expect(settle).toHaveBeenCalledWith(7, { state: "unknown", counts: false, code }, null);
    }
    expect(classifySendFailure(new Error("other"))).toEqual({ state: "unknown", counts: false, code: null });
  });

  it("keeps parameters on one line and the answers within 300 characters, cut at a word", async () => {
    expect(templateText("Name\nwith\ttabs     and spaces")).toBe("Name with tabs   and spaces");
    expect(templateText("   ")).toBe("—");
    const long = answersLine([{ question: "City", answer: "Mohali" }, { question: "Roof size?", answer: "about ".repeat(80) }]);
    expect([...long].length).toBeLessThanOrEqual(300);
    expect(long.startsWith("City: Mohali · Roof size?: about")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
    expect(answersLine([])).toBe("—");
    expect(answersLine([{ question: "शहर", answer: " मोहाली \n" }])).toBe("शहर: मोहाली");
    await expect(sendTemplate(config, { to: "+919800000009", template: "x", language: "en", params: [] }, async () => UNDELIVERABLE())).rejects.toBeInstanceOf(WhatsAppSendError);
  });

  it("finds templates Meta moved to MARKETING in a WhatsApp Business Account webhook", () => {
    const body = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [
      { field: "template_category_update", value: { message_template_id: 1, message_template_name: "adbrain_lead_alert", message_template_language: "en", previous_category: "UTILITY", new_category: "MARKETING" } },
      { field: "template_category_update", value: { message_template_name: "adbrain_daily_results", previous_category: "MARKETING", new_category: "UTILITY" } },
      { field: "messages", value: { messages: [] } },
    ] }] };
    expect(recategorisedTemplates(body)).toEqual([{ template: "adbrain_lead_alert", category: "MARKETING" }]);
    expect(recategorisedTemplates({ object: "page", entry: body.entry })).toEqual([]);
    expect(recategorisedTemplates(null)).toEqual([]);
  });

  it("reads the claim function's answers strictly and calls the service functions with their argument names", async () => {
    expect(parseClaim({ claimed: true, sendId: 3, phone: "+919800000009", language: "hi" })).toEqual({ claimed: true, sendId: 3, phone: "+919800000009", language: "hi" });
    expect(parseClaim({ claimed: false, reason: "cap" })).toEqual({ claimed: false, reason: "cap" });
    expect(() => parseClaim({ claimed: true, sendId: 3, phone: "9800" })).toThrow();
    expect(() => parseClaim({ claimed: false, reason: "whatever" })).toThrow();
    const rpc = vi.fn(async (fn: string) => ({ data: fn === "owner_alert_claim" ? { claimed: false, reason: "duplicate" } : null, error: null }));
    const s = supabaseAlertStore({ rpc });
    await s.claim({ businessId: "b1", kind: "daily", key: "2026-10-27", template: "t", monthCap: 300 });
    await s.settle(9, { state: "failed", counts: true, code: "131026" }, null);
    await s.blockTemplate("t", "MARKETING");
    expect(rpc.mock.calls).toEqual([
      ["owner_alert_claim", { p_business_id: "b1", p_kind: "daily", p_key: "2026-10-27", p_template: "t", p_month_cap: 300 }],
      ["owner_alert_settle", { p_send_id: 9, p_state: "failed", p_error_code: "131026", p_wa_message_id: null, p_counts: true }],
      ["owner_alert_template_block", { p_template: "t", p_category: "MARKETING" }],
    ]);
    await expect(supabaseAlertStore({ rpc: async () => ({ data: null, error: { message: "boom" } }) }).settle(1, { state: "sent", counts: false, code: null }, "w")).rejects.toThrow("Alert owner_alert_settle failed.");
  });
});
