import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * #701: owner WhatsApp alerts, opt-in side. An owner confirms their number by sending
 * "START <code>" to AdBrain's alerts number; "STOP" (or बंद) turns both alerts off.
 */
export type AlertCommand = { kind: "start"; code: string } | { kind: "stop" };

const START = /^\s*start\s+([a-f0-9]{10})\s*[.!]?\s*$/i;
const STOP = /^\s*(stop|unsubscribe|बंद|band|ਬੰਦ)\s*[.!]?\s*$/i;

export function alertCommand(text: string): AlertCommand | null {
  const start = START.exec(text);
  if (start) return { kind: "start", code: start[1].toUpperCase() };
  return STOP.test(text) ? { kind: "stop" } : null;
}

/** The wa.me link that opens WhatsApp with "START <code>" ready to send to AdBrain's number. */
export function alertStartLink(alertsNumber: string, code: string): string | null {
  const digits = alertsNumber.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(`START ${code}`)}` : null;
}

/** Meta's X-Hub-Signature-256: HMAC-SHA256 of the raw body with the app secret. */
export function validWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Text messages in a WhatsApp Cloud API webhook body (entry → changes → value.messages), sender as +E.164. */
export function inboundTexts(body: unknown, alertsNumber: string): { from: string; text: string }[] {
  const expectedNumber = alertsNumber.replace(/\D/g, "");
  if (!expectedNumber) return [];
  const entries = (body as { object?: unknown; entry?: unknown } | null)?.object === "whatsapp_business_account"
    ? (body as { entry?: unknown }).entry : [];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : [])
    .filter((change) => change?.field === "messages")
    .filter((change) => typeof change?.value?.metadata?.display_phone_number === "string"
      && change.value.metadata.display_phone_number.replace(/\D/g, "") === expectedNumber)
    .flatMap((change) => Array.isArray(change?.value?.messages) ? change.value.messages : [])
    .flatMap((message) => message?.type === "text" && typeof message.from === "string" && /^\d{7,15}$/.test(message.from) && typeof message.text?.body === "string"
      ? [{ from: `+${message.from}`, text: message.text.body.slice(0, 200) }] : []);
}
