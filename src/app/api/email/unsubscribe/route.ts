import { z } from "zod";
import { verifyUnsubscribeToken } from "@/lib/leads/notify";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const tokenSchema = z.string().min(40).max(200);
const page = (body: string, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdBrain</title>`
  + `<body style="font-family:Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px">${body}</body>`, { status, headers });

// Needs only the link secret, so links keep working even if sending is switched off.
function businessFor(token: unknown) {
  const secret = process.env.EMAIL_LINK_SECRET ?? "";
  const parsed = tokenSchema.safeParse(token);
  return secret.length >= 16 && parsed.success ? verifyUnsubscribeToken(parsed.data, secret) : null;
}

// A link preview or mail scanner may fetch the link, so GET only shows a confirm button.
export const GET = observeRoute("/api/email/unsubscribe", "GET", async (request: Request) => {
  const token = new URL(request.url).searchParams.get("token");
  if (!businessFor(token)) return page("<h1>This link is not valid</h1><p>You can switch enquiry emails off in AdBrain Settings.</p>", 400);
  return page(`<h1>Stop enquiry emails?</h1><p>You will no longer get an email when a new enquiry arrives. You can turn it back on in AdBrain Settings.</p>`
    + `<form method="post" action="/api/email/unsubscribe"><input type="hidden" name="token" value="${token}">`
    + `<button type="submit" style="padding:10px 16px">Unsubscribe</button></form>`);
});

// Also serves RFC 8058 one-click unsubscribe, where the mail client posts to the link itself.
export const POST = observeRoute("/api/email/unsubscribe", "POST", async (request: Request) => {
  const fromQuery = new URL(request.url).searchParams.get("token");
  const form = await request.formData().catch(() => null);
  const fromForm = form?.get("token");
  const businessId = businessFor(fromQuery ?? (typeof fromForm === "string" ? fromForm : null));
  if (!businessId) return page("<h1>This link is not valid</h1><p>You can switch enquiry emails off in AdBrain Settings.</p>", 400);
  const { error } = await createAdminClient().rpc("lead_email_unsubscribe", { p_business_id: businessId });
  if (error) return page("<h1>Something went wrong</h1><p>Please try again, or switch enquiry emails off in AdBrain Settings.</p>", 503);
  return page("<h1>You are unsubscribed</h1><p>You will not get enquiry emails. You can turn them back on in AdBrain Settings.</p>");
});
