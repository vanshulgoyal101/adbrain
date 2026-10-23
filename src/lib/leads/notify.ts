import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { EmailSendError, type EmailMessage, type EmailProvider } from "@/lib/email/provider";

type Environment = Readonly<Record<string, string | undefined>>;
export type LeadEmailConfig = { apiKey: string; from: string; secret: string; siteUrl: string };

/** Null unless the flag is on and every setting is present, so a half-configured server sends nothing. */
export function leadEmailConfig(environment: Environment = process.env): LeadEmailConfig | null {
  const siteUrl = environment.NEXT_PUBLIC_SITE_URL ?? "";
  if (environment.LEAD_EMAIL_ENABLED !== "true" || !environment.RESEND_API_KEY || !environment.LEAD_EMAIL_FROM
    || (environment.EMAIL_LINK_SECRET ?? "").length < 16 || !siteUrl.startsWith("https://")) return null;
  return { apiKey: environment.RESEND_API_KEY, from: environment.LEAD_EMAIL_FROM, secret: environment.EMAIL_LINK_SECRET!, siteUrl: siteUrl.replace(/\/+$/, "") };
}

const uuid = z.uuid();
const signature = (businessId: string, secret: string) =>
  createHmac("sha256", secret).update(`lead-email-unsubscribe:${businessId}`).digest("base64url");

export function signUnsubscribeToken(businessId: string, secret: string) {
  return `${businessId}.${signature(businessId, secret)}`;
}

/** Returns the business id for a genuine token, else null. Tokens do not expire: an unsubscribe link must keep working. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const [businessId, given, ...rest] = token.split(".");
  if (rest.length || !given || !uuid.safeParse(businessId).success) return null;
  const expected = Buffer.from(signature(businessId, secret));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? businessId : null;
}

const claimedSchema = z.array(z.object({
  leadId: z.uuid(), businessId: z.uuid(), ownerId: z.uuid(), businessName: z.string().nullable(),
  fullName: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), city: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()).nullable(), formName: z.string().nullable(), receivedAt: z.string(), attempt: z.number().int(),
}));
export type ClaimedLead = z.infer<typeof claimedSchema>[number];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const clean = (value: string | null | undefined, max: number) =>
  (value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, max);

export function renderLeadEmail(lead: ClaimedLead, unsubscribeUrl: string): Pick<EmailMessage, "subject" | "html" | "text" | "headers"> {
  const name = clean(lead.fullName, 80) || "New enquiry";
  const phone = /^\+?\d{6,15}$/.test(lead.phone ?? "") ? lead.phone! : null;
  const business = clean(lead.businessName, 80);
  const rows: [string, string][] = [["Name", name], ["Phone", clean(lead.phone, 40)], ["Email", clean(lead.email, 120)], ["City", clean(lead.city, 80)],
    ["Form", clean(lead.formName, 120)]];
  const answers = Object.entries(lead.fields ?? {}).filter(([, value]) => typeof value === "string").slice(0, 20)
    .map(([key, value]) => [clean(key.replace(/_/g, " "), 60), clean(value as string, 300)] as [string, string]);
  const shown = [...rows, ...answers].filter(([, value]) => value);
  const received = new Date(lead.receivedAt);
  const when = Number.isFinite(received.getTime()) ? received.toUTCString() : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="margin:0 0 8px">New enquiry${business ? ` for ${escapeHtml(business)}` : ""}</h2>
${when ? `<p style="margin:0 0 12px;color:#475569">Received ${escapeHtml(when)}</p>` : ""}
<table style="border-collapse:collapse;width:100%">${shown.map(([label, value]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#475569;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`).join("")}</table>
${phone ? `<p style="margin:16px 0"><a href="tel:${escapeHtml(phone)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Call now</a></p>` : ""}
<p style="color:#64748b;font-size:12px">You get this because new enquiries are switched on in AdBrain Settings. <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>
</div>`;
  const lines = [`New enquiry${business ? ` for ${business}` : ""}`];
  if (when) lines.push(`Received ${when}`);
  lines.push("", ...shown.map(([label, value]) => `${label}: ${value}`));
  if (phone) lines.push("", `Call now: tel:${phone}`);
  lines.push("", `Unsubscribe: ${unsubscribeUrl}`);
  const text = lines.join("\n");
  return {
    subject: `New enquiry: ${name}`.slice(0, 120), html, text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export interface NotifyStore {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  ownerEmail(ownerId: string): Promise<string | null>;
}
export type NotifySummary = { claimed: number; sent: number; retried: number; failed: number; error?: "claim_failed" };

/** Sends the queued enquiry emails. Logs and returns counts only: no enquiry data leaves this function. */
export async function sendLeadNotifications(deps: { store: NotifyStore; provider: EmailProvider; config: LeadEmailConfig; limit?: number }): Promise<NotifySummary> {
  const summary: NotifySummary = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  const claim = await deps.store.rpc("lead_notifications_claim", { p_limit: deps.limit ?? 10 });
  const parsed = claimedSchema.safeParse(claim.data);
  if (claim.error || !parsed.success) return { ...summary, error: "claim_failed" };
  summary.claimed = parsed.data.length;
  await Promise.all(parsed.data.map(async lead => {
    let outcome: "sent" | "retry" | "failed" = "sent";
    let code: string | null = null;
    try {
      const to = await deps.store.ownerEmail(lead.ownerId);
      if (!to) { outcome = "failed"; code = "no_recipient"; }
      else {
        const url = `${deps.config.siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(lead.businessId, deps.config.secret))}`;
        await deps.provider.send({ to, ...renderLeadEmail(lead, url), idempotencyKey: `lead-${lead.leadId}` });
      }
    } catch (error) {
      code = error instanceof EmailSendError ? error.code : "unexpected";
      outcome = error instanceof EmailSendError && !error.retryable ? "failed" : "retry";
    }
    // A lost result leaves the row 'sending'; it is reclaimed after 10 minutes and the provider's idempotency key stops a second send.
    await Promise.resolve(deps.store.rpc("lead_notification_result", { p_lead_id: lead.leadId, p_outcome: outcome, p_error: code })).catch(() => undefined);
    if (outcome === "sent") summary.sent++; else if (outcome === "retry") summary.retried++; else summary.failed++;
  }));
  return summary;
}
