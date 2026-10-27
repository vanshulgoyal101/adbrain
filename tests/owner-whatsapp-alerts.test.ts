import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertCommand, alertStartLink, inboundTexts, validWebhookSignature } from "@/lib/alerts/owner-alerts";
import { alertSettingsFrom } from "@/lib/alerts/alert-settings";

const env = vi.hoisted(() => ({ META_APP_SECRET: "app-secret", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me", ALERTS_WHATSAPP: "+91 98000 00000" }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ getEnv: () => env }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

// The shape of Meta's WhatsApp Cloud API "messages" webhook (developers.facebook.com, webhooks/payload-examples).
const delivery = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "919800000000", phone_number_id: "PHONE_ID" },
    contacts: [{ profile: { name: "Owner" }, wa_id: "919811112222" }], messages, ...extra,
  } }] }],
});
const text = (from: string, body: string) => ({ from, id: `wamid.${body.length}`, timestamp: "1730000000", type: "text", text: { body } });
const sign = (raw: string, secret = env.META_APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? sign(raw) } });
};

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });

describe("owner WhatsApp alerts: opt-in commands (#701)", () => {
  it("reads START <code> and STOP in English, Hindi and Punjabi, and nothing else", () => {
    expect(alertCommand("START a1b2c3d4e5")).toEqual({ kind: "start", code: "A1B2C3D4E5" });
    expect(alertCommand("  start A1B2C3D4E5. ")).toEqual({ kind: "start", code: "A1B2C3D4E5" });
    for (const stop of ["STOP", "stop", "बंद", "Band", "ਬੰਦ", "unsubscribe"]) expect(alertCommand(stop)).toEqual({ kind: "stop" });
    for (const other of ["START", "START 12345", "please stop sending", "Hi", "START A1B2C3D4E5 now"]) expect(alertCommand(other)).toBeNull();
  });

  it("links to AdBrain's number with START <code> ready to send", () => {
    expect(alertStartLink("+91 98000 00000", "A1B2C3D4E5")).toBe("https://wa.me/919800000000?text=START%20A1B2C3D4E5");
    expect(alertStartLink("", "A1B2C3D4E5")).toBeNull();
  });

  it("checks Meta's signature over the raw body", () => {
    const raw = JSON.stringify(delivery([]));
    expect(validWebhookSignature(raw, sign(raw), "app-secret")).toBe(true);
    expect(validWebhookSignature(raw, sign(raw, "other"), "app-secret")).toBe(false);
    expect(validWebhookSignature(raw, sign(raw), "")).toBe(false);
    expect(validWebhookSignature(raw, null, "app-secret")).toBe(false);
  });

  it("takes only text messages, with the sender as +E.164; delivery statuses and media are ignored", () => {
    const body = delivery([text("919811112222", "STOP"), { from: "919811112222", type: "image", image: { id: "1" } }], { statuses: [{ id: "wamid.x", status: "read" }] });
    expect(inboundTexts(body, "+91 98000 00000")).toEqual([{ from: "+919811112222", text: "STOP" }]);
    expect(inboundTexts(body, "+91 98000 00001")).toEqual([]);
    expect(inboundTexts({ object: "page", entry: [] }, "+91 98000 00000")).toEqual([]);
  });

  it("shows the number masked, and only once confirmed", () => {
    const row = { lead_alerts: true, daily_results: false, language: "hi" as const, phone_e164: "+919811112222", verified_at: null, opted_out_at: null };
    expect(alertSettingsFrom(row).number).toBeNull();
    expect(alertSettingsFrom({ ...row, verified_at: "2026-10-27T10:00:00Z" })).toEqual({ leadAlerts: true, dailyResults: false, language: "hi", number: "+91 ••••• 2222", optedOut: false });
    expect(alertSettingsFrom(null)).toEqual({ leadAlerts: false, dailyResults: false, language: "en", number: null, optedOut: false });
  });
});

describe("POST /api/whatsapp/webhook (#701)", () => {
  it("START <code> confirms the sender's number; STOP turns alerts off", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    expect((await POST(post(delivery([text("919811112222", "START a1b2c3d4e5"), text("919833334444", "बंद"), text("919855556666", "Hello")])))).status).toBe(200);
    expect(rpc.mock.calls).toEqual([
      ["owner_alert_confirm", { p_code: "A1B2C3D4E5", p_phone: "+919811112222" }],
      ["owner_alert_stop", { p_phone: "+919833334444" }],
    ]);
  });

  it("ignores messages delivered to a different WhatsApp number", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    expect((await POST(post(delivery([text("919811112222", "STOP")], { metadata: { display_phone_number: "919800000001" } })))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unsigned or wrongly signed delivery without touching the database", async () => {
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    expect((await POST(post(delivery([text("919811112222", "STOP")]), "sha256=deadbeef"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks Meta to retry when the opt-out can't be recorded", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    const { POST } = await import("@/app/api/whatsapp/webhook/route");
    expect((await POST(post(delivery([text("919811112222", "STOP")])))).status).toBe(503);
  });

  it("answers Meta's subscribe handshake only with the right token", async () => {
    const { GET } = await import("@/app/api/whatsapp/webhook/route");
    const ok = await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"))).status).toBe(403);
  });
});
