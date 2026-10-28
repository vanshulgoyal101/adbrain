/**
 * #701 slice 2: sends an owner's WhatsApp alert from AdBrain's alerts number as an approved
 * utility template (Cloud API), at most once per lead or day. Dark until `OWNER_ALERTS_ENABLED=true`.
 * The database decides who may get one (`owner_alert_claim`: verified, not opted out, switch on,
 * not paused, template not blocked, under the monthly cap) and records Meta's answer
 * (`owner_alert_settle`: 3 counted failures pause the owner).
 */
import { GRAPH } from "@/lib/meta/graph-version";

/**
 * Platform-wide sends per IST month (CPO §1 on #701: ≈ ₹540 with GST at ₹0.115). `owner_alert_claim`
 * counts every business's sends, lead alerts included, and refuses only the daily line at the cap.
 */
export const ALERT_MONTH_CAP = 4000;
/** Characters of the answers line in a lead alert (one template parameter, one line). */
export const ANSWERS_LIMIT = 300;

export type AlertKind = "lead" | "daily";
export type AlertLanguage = "en" | "hi";
export type AlertConfig = { phoneNumberId: string; token: string; templates: Record<AlertKind, string> };

export function ownerAlertsConfig(env: Record<string, string | undefined> = process.env): AlertConfig | null {
  if (env.OWNER_ALERTS_ENABLED !== "true") return null;
  const phoneNumberId = env.ALERTS_WHATSAPP_PHONE_ID?.trim() ?? "";
  const token = env.ALERTS_WHATSAPP_TOKEN?.trim() ?? "";
  if (!/^\d{5,32}$/.test(phoneNumberId) || !token) return null;
  return {
    phoneNumberId, token,
    templates: { lead: env.ALERTS_LEAD_TEMPLATE?.trim() || "adbrain_lead_alert", daily: env.ALERTS_DAILY_TEMPLATE?.trim() || "adbrain_daily_results" },
  };
}

/** A lead's answers as one line: "Question: answer · Question: answer", whitespace collapsed, cut at a word. */
export function answersLine(answers: { question: string; answer: string }[], limit = ANSWERS_LIMIT): string {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const line = answers.map(({ question, answer }) => [flat(question), flat(answer)].filter(Boolean).join(": ")).filter(Boolean).join(" · ") || "—";
  const chars = [...line];
  if (chars.length <= limit) return line;
  const cut = chars.slice(0, limit - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** WhatsApp template parameters must not carry newlines, tabs or 4+ spaces (Meta refuses with 132018). */
export function templateText(text: string, limit = 1024): string {
  const clean = text.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "—";
  return [...clean].slice(0, limit).join("");
}

export class WhatsAppSendError extends Error {
  constructor(readonly status: number | null, readonly code: number | null, readonly timedOut = false) {
    super(code ? `WhatsApp send refused (${code})` : timedOut ? "WhatsApp send timed out" : `WhatsApp send failed (${status ?? "network"})`);
    this.name = "WhatsAppSendError";
  }
}

/** One template message to one number. Returns Meta's message id. Never retried here. */
export async function sendTemplate(
  config: Pick<AlertConfig, "phoneNumberId" | "token">,
  message: { to: string; template: string; language: AlertLanguage; params: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${GRAPH}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: message.to.replace(/^\+/, ""), type: "template",
        template: { name: message.template, language: { code: message.language }, components: [{ type: "body", parameters: message.params.map((text) => ({ type: "text", text: templateText(text) })) }] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // A timeout or dropped connection may still have reached Meta: the caller must not resend.
    throw new WhatsAppSendError(null, null, error instanceof Error && error.name === "TimeoutError");
  }
  const body = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: number } } | null;
  const id = body?.messages?.[0]?.id;
  if (response.ok && typeof id === "string") return id;
  throw new WhatsAppSendError(response.status, typeof body?.error?.code === "number" ? body.error.code : null);
}

export type SendOutcome = { state: "sent" | "failed" | "retry" | "unknown"; counts: boolean; code: string | null };

/**
 * What a failed send means, by Meta's Cloud API error codes:
 * - 131026 message undeliverable (the owner's number can't get it): failed, counts toward the pause.
 * - 130429/131056/80007 rate limits, 131000/1/2 or a 5xx without a code: retry on a later run.
 * - Everything else Meta refuses (132018 template parameters, 132000–132016 template missing, paused
 *   or disabled, 131047 re-engagement, 100/131008/131009 bad request, 190/10/200 token or permission):
 *   failed on our side, so it doesn't count against the owner.
 * - No answer (timeout, network): unknown, never resent (it may have been delivered).
 */
export function classifySendFailure(error: unknown): SendOutcome {
  if (!(error instanceof WhatsAppSendError)) return { state: "unknown", counts: false, code: null };
  if (error.status === null) return { state: "unknown", counts: false, code: error.timedOut ? "timeout" : "network" };
  const code = error.code;
  if (code === 131026) return { state: "failed", counts: true, code: "131026" };
  if (code !== null && [130429, 131056, 80007, 131000, 1, 2].includes(code)) return { state: "retry", counts: false, code: String(code) };
  if (code === null && error.status >= 500) return { state: "retry", counts: false, code: `http.${error.status}` };
  return { state: "failed", counts: false, code: code === null ? `http.${error.status}` : String(code) };
}

export type ClaimResult =
  | { claimed: true; sendId: number; phone: string; language: AlertLanguage }
  | { claimed: false; reason: "unverified" | "opted_out" | "off" | "paused" | "template_blocked" | "cap" | "duplicate" };

export interface AlertStore {
  claim(input: { businessId: string; kind: AlertKind; key: string; template: string; monthCap: number }): Promise<ClaimResult>;
  settle(sendId: number, outcome: SendOutcome, messageId: string | null): Promise<void>;
}

export type DeliverResult = { delivered: boolean; reason: string };

/** Claim → send → settle. `params` gets the owner's language so the words match the template's. */
export async function deliverOwnerAlert(
  deps: { store: AlertStore; config: AlertConfig | null; fetchImpl?: typeof fetch },
  alert: { businessId: string; kind: AlertKind; key: string; params: (language: AlertLanguage) => string[] },
): Promise<DeliverResult> {
  if (!deps.config) return { delivered: false, reason: "disabled" };
  const template = deps.config.templates[alert.kind];
  const claim = await deps.store.claim({ businessId: alert.businessId, kind: alert.kind, key: alert.key, template, monthCap: ALERT_MONTH_CAP });
  if (!claim.claimed) return { delivered: false, reason: claim.reason };
  try {
    const messageId = await sendTemplate(deps.config, { to: claim.phone, template, language: claim.language, params: alert.params(claim.language) }, deps.fetchImpl);
    await deps.store.settle(claim.sendId, { state: "sent", counts: false, code: null }, messageId);
    return { delivered: true, reason: "sent" };
  } catch (error) {
    const outcome = classifySendFailure(error);
    await deps.store.settle(claim.sendId, outcome, null);
    return { delivered: false, reason: outcome.code ?? outcome.state };
  }
}

/**
 * Templates Meta moved out of UTILITY, or will move within 24 h (`correct_category`, #1139), from a
 * WhatsApp Business Account webhook (`template_category_update`). A marketing template costs more and
 * needs marketing consent: stop it.
 */
export function recategorisedTemplates(body: unknown): { template: string; category: string }[] {
  const entries = (body as { object?: unknown; entry?: unknown } | null)?.object === "whatsapp_business_account"
    ? (body as { entry?: unknown }).entry : [];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : [])
    .filter((change) => change?.field === "template_category_update")
    .flatMap((change) => {
      const value = change?.value as { message_template_name?: unknown; new_category?: unknown; correct_category?: unknown } | undefined;
      const category = typeof value?.correct_category === "string" ? value.correct_category : value?.new_category;
      return typeof value?.message_template_name === "string" && value.message_template_name && typeof category === "string" && category && category.toUpperCase() !== "UTILITY"
        ? [{ template: value.message_template_name.slice(0, 512), category: category.toUpperCase().slice(0, 32) }] : [];
    });
}
