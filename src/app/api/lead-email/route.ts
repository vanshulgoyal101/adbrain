import { NextResponse } from "next/server";
import { z } from "zod";
import { leadEmailConfig } from "@/lib/leads/notify";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const failure = (code?: string) => NextResponse.json({ error: code === "42501" ? "Business unavailable." : "Could not load the email setting." },
  { status: code === "42501" ? 404 : 503 });

export const GET = observeRoute("/api/lead-email", "GET", async (request: Request) => {
  const businessId = z.uuid().safeParse(new URL(request.url).searchParams.get("businessId"));
  if (!businessId.success) return NextResponse.json({ error: "Invalid business." }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await client.rpc("lead_email_setting_get", { p_business_id: businessId.data });
  if (error || typeof data !== "boolean") return failure(error?.code);
  return NextResponse.json({ enabled: data, available: leadEmailConfig() !== null }, { headers: noStore });
});

export const POST = observeRoute("/api/lead-email", "POST", async (request: Request) => {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 });
  }
  const limited = await rateLimitResponse(`lead-email:${user.id}`, { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const input = z.strictObject({ businessId: z.uuid(), enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { data, error } = await client.rpc("lead_email_setting_set", { p_business_id: input.data.businessId, p_enabled: input.data.enabled });
  if (error || typeof data !== "boolean") return failure(error?.code);
  return NextResponse.json({ enabled: data, available: leadEmailConfig() !== null }, { headers: noStore });
});
