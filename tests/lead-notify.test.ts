import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendProvider, EmailSendError, type EmailMessage } from "@/lib/email/provider";
import { leadEmailConfig, renderLeadEmail, sendLeadNotifications, signUnsubscribeToken, verifyUnsubscribeToken,
  type ClaimedLead, type LeadEmailConfig, type NotifyStore } from "@/lib/leads/notify";

const SECRET = "link-secret-of-16+chars";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const ownerId = "11111111-1111-4111-8111-111111111111";
const environment = { LEAD_EMAIL_ENABLED: "true", RESEND_API_KEY: "re_key", LEAD_EMAIL_FROM: "AdBrain <alerts@vanshul.com>",
  EMAIL_LINK_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: "https://adbrain.vanshul.com/" };
const config: LeadEmailConfig = leadEmailConfig(environment)!;

function lead(overrides: Partial<ClaimedLead> = {}): ClaimedLead {
  return { leadId: "22222222-2222-4222-8222-222222222222", businessId, ownerId, businessName: "Solaride", fullName: "Asha Verma",
    phone: "+919876543210", email: "asha@example.com", city: "Mohali", formName: "Diwali 10%", receivedAt: "2026-10-23T09:30:00Z",
    fields: { roof_type: "Flat concrete", monthly_bill: "4500" }, attempt: 1, ...overrides };
}

afterEach(() => vi.restoreAllMocks());

describe("enquiry email settings gate", () => {
  it("needs the flag and every setting, and an https site", () => {
    expect(config).toMatchObject({ apiKey: "re_key", siteUrl: "https://adbrain.vanshul.com" });
    for (const [name, value] of [["LEAD_EMAIL_ENABLED", "false"], ["LEAD_EMAIL_ENABLED", undefined], ["RESEND_API_KEY", ""], ["LEAD_EMAIL_FROM", ""],
      ["EMAIL_LINK_SECRET", "short"], ["NEXT_PUBLIC_SITE_URL", "http://localhost:3000"]] as const) {
      expect(leadEmailConfig({ ...environment, [name]: value }), `${name}=${value}`).toBeNull();
    }
  });
});

describe("unsubscribe tokens", () => {
  it("verify for their own business and reject anything else", () => {
    const token = signUnsubscribeToken(businessId, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(businessId);
    expect(verifyUnsubscribeToken(token, "another-secret-16+chars")).toBeNull();
    const [, signature] = token.split(".");
    const other = "22222222-2222-4222-8222-222222222222";
    for (const forged of [`${other}.${signature}`, `${businessId}.`, `${businessId}`, `${token}.extra`, `not-a-uuid.${signature}`, "", `${businessId}.${signature.slice(0, -2)}AA`]) {
      expect(verifyUnsubscribeToken(forged, SECRET), forged).toBeNull();
    }
  });
});

describe("enquiry email content", () => {
  const url = "https://adbrain.vanshul.com/api/email/unsubscribe?token=t";
  it("has the name, phone, answers, ad form, a Call now link and an unsubscribe link", () => {
    const email = renderLeadEmail(lead(), url);
    expect(email.subject).toBe("New enquiry: Asha Verma");
    for (const part of ["Asha Verma", "+919876543210", "asha@example.com", "Mohali", "Diwali 10%", "roof type", "Flat concrete", "monthly bill", "4500"]) {
      expect(email.html).toContain(part);
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain('href="tel:+919876543210"');
    expect(email.html).toContain(">Call now<");
    expect(email.text).toContain("Call now: tel:+919876543210");
    expect(email.html).toContain(`href="${url}"`);
    expect(email.headers).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("escapes what the enquirer typed and keeps it out of headers", () => {
    const email = renderLeadEmail(lead({ fullName: "<script>alert(1)</script>\r\nBcc: x@y.z", fields: { note: '"><img src=x onerror=alert(1)>' } }), url);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("offers no Call now link for a number that is not a phone number", () => {
    const email = renderLeadEmail(lead({ phone: "javascript:alert(1)" }), url);
    expect(email.html).not.toContain("tel:");
    expect(email.html).not.toContain("Call now");
  });
});

function store(rows: ClaimedLead[], owner: string | null = "owner@example.com") {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const impl: NotifyStore = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === "lead_notifications_claim" ? rows : null, error: null };
    },
    ownerEmail: async () => owner,
  };
  return { impl, calls };
}
const provider = (send: (message: EmailMessage) => Promise<void>) => ({ send: vi.fn(send) });

describe("sending queued enquiries", () => {
  it("sends one email per claimed enquiry, keyed by the lead, and records it", async () => {
    const rows = [lead(), lead({ leadId: "33333333-3333-4333-8333-333333333333", fullName: "Ravi" })];
    const { impl, calls } = store(rows);
    const sender = provider(async () => undefined);
    const summary = await sendLeadNotifications({ store: impl, provider: sender, config });
    expect(summary).toEqual({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send.mock.calls.map(([message]) => message.idempotencyKey)).toEqual(
      ["lead-22222222-2222-4222-8222-222222222222", "lead-33333333-3333-4333-8333-333333333333"]);
    expect(sender.send.mock.calls[0][0].to).toBe("owner@example.com");
    expect(verifyUnsubscribeToken(new URL(sender.send.mock.calls[0][0].headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("token")!, SECRET)).toBe(businessId);
    expect(calls.filter(call => call.name === "lead_notification_result").map(call => call.args?.p_outcome)).toEqual(["sent", "sent"]);
  });

  it("sends nothing when nothing is queued, so a re-synced lead never emails again", async () => {
    const { impl, calls } = store([]);
    const sender = provider(async () => undefined);
    expect(await sendLeadNotifications({ store: impl, provider: sender, config })).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    expect(calls.map(call => call.name)).toEqual(["lead_notifications_claim"]);
  });

  it("retries outages and rate limits, gives up on rejections and missing recipients", async () => {
    const cases: [string, Error | null, string | null, "retry" | "failed", string][] = [
      ["outage", new EmailSendError(true, "http_503"), "owner@example.com", "retry", "http_503"],
      ["unexpected", new Error("boom"), "owner@example.com", "retry", "unexpected"],
      ["rejected", new EmailSendError(false, "http_422"), "owner@example.com", "failed", "http_422"],
      ["no owner email", null, null, "failed", "no_recipient"],
    ];
    for (const [label, error, owner, outcome, code] of cases) {
      const { impl, calls } = store([lead()], owner);
      const sender = provider(async () => { if (error) throw error; });
      const summary = await sendLeadNotifications({ store: impl, provider: sender, config });
      const result = calls.find(call => call.name === "lead_notification_result")!;
      expect([label, result.args?.p_outcome, result.args?.p_error], label).toEqual([label, outcome, code]);
      expect(summary.sent).toBe(0);
      expect(sender.send).toHaveBeenCalledTimes(owner ? 1 : 0);
    }
  });

  it("reports a claim failure without sending", async () => {
    const sender = provider(async () => undefined);
    const failing: NotifyStore = { rpc: async () => ({ data: null, error: { code: "XX000" } }), ownerEmail: async () => "x@y.z" };
    expect(await sendLeadNotifications({ store: failing, provider: sender, config })).toMatchObject({ claimed: 0, error: "claim_failed" });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("writes no enquiry data to the logs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const { impl } = store([lead()]);
    await sendLeadNotifications({ store: impl, provider: provider(async () => { throw new EmailSendError(true, "http_503"); }), config });
    expect(JSON.stringify(spies.flatMap(spy => spy.mock.calls))).not.toMatch(/Asha|9876543210|asha@example/);
  });
});

describe("Resend provider", () => {
  const message: EmailMessage = { to: "owner@example.com", subject: "S", html: "<p>h</p>", text: "t", headers: { "List-Unsubscribe": "<u>" }, idempotencyKey: "lead-1" };
  it("posts the message with the key and idempotency header", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "email_1" }));
    await createResendProvider({ apiKey: "re_key", from: "AdBrain <a@b.c>", fetcher: fetcher as unknown as typeof fetch }).send(message);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_key", "Idempotency-Key": "lead-1" });
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "AdBrain <a@b.c>", to: ["owner@example.com"], subject: "S", headers: { "List-Unsubscribe": "<u>" } });
  });

  it.each([[429, true], [500, true], [503, true], [400, false], [401, false], [422, false]])("classifies HTTP %s as retryable=%s", async (status, retryable) => {
    const send = createResendProvider({ apiKey: "k", from: "f", fetcher: (async () => new Response("{}", { status })) as unknown as typeof fetch }).send(message);
    await expect(send).rejects.toMatchObject({ retryable, code: `http_${status}` });
  });

  it("treats a network failure as retryable", async () => {
    const send = createResendProvider({ apiKey: "k", from: "f", fetcher: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }).send(message);
    await expect(send).rejects.toMatchObject({ retryable: true, code: "network" });
  });
});
