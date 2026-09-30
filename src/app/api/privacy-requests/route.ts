import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const fields = "id,kind,status,created_at,updated_at";
const noStore = { "Cache-Control": "no-store" };

export const GET = observeRoute("/api/privacy-requests", "GET", async () => {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await client.from("privacy_requests").select(fields).eq("owner_id", user.id)
    .order("created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "Privacy requests are temporarily unavailable." }, { status: 503 });
  return NextResponse.json({ requests: data }, { headers: noStore });
});

export const POST = observeRoute("/api/privacy-requests", "POST", async (request: Request) => {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 });
  }
  const limited = await rateLimitResponse(`privacy-requests:${user.id}`, { limit: 5, windowMs: 60 * 60_000 });
  if (limited) return limited;
  const input = z.strictObject({ kind: z.enum(["export", "delete"]) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose export or deletion." }, { status: 400 });
  const { data, error } = await client.from("privacy_requests").insert({ owner_id: user.id, kind: input.data.kind })
    .select(fields).single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "An open request of this type already exists." : "Could not submit your request." },
    { status: error.code === "23505" ? 409 : 503 });
  return NextResponse.json({ request: data }, { status: 201, headers: noStore });
});