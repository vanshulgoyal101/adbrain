import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { alertCommand, inboundTexts, validWebhookSignature } from "@/lib/alerts/owner-alerts";
import { supabaseAlertStore } from "@/lib/alerts/alert-store";
import { recategorisedTemplates } from "@/lib/alerts/sender";

export const runtime = "nodejs";

/** #701: Meta's subscribe handshake for AdBrain's alerts number. */
export const GET = observeRoute("/api/whatsapp/webhook", "GET", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const token = getEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (token && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === token) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
});

/**
 * #701: messages to AdBrain's alerts number. "START <code>" confirms an owner's number for alerts;
 * "STOP" or "बंद" turns them off. Anything else is ignored. Message text is never logged.
 * #1139: a template Meta moves (or will move) out of UTILITY is blocked, so no alert goes out on it.
 */
export const POST = observeRoute("/api/whatsapp/webhook", "POST", async (request: Request) => {
  const raw = await request.text();
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"), getEnv().META_APP_SECRET)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const admin = createAdminClient();
  const store = supabaseAlertStore(admin as unknown as Parameters<typeof supabaseAlertStore>[0]);
  for (const { template, category } of recategorisedTemplates(body)) {
    try { await store.blockTemplate(template, category); } catch {
      return NextResponse.json({ error: "Template block could not be recorded." }, { status: 503 });
    }
  }
  for (const message of inboundTexts(body, getEnv().ALERTS_WHATSAPP)) {
    const command = alertCommand(message.text);
    if (!command) continue;
    const { error } = command.kind === "start"
      ? await admin.rpc("owner_alert_confirm", { p_code: command.code, p_phone: message.from })
      : await admin.rpc("owner_alert_stop", { p_phone: message.from });
    // A failure makes Meta retry the whole delivery; both functions are idempotent.
    if (error) return NextResponse.json({ error: "Alert opt-in could not be recorded." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
});
