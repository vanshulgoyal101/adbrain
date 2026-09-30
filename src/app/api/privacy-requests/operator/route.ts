import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const fields = "id,owner_id,kind,status,created_at,updated_at";

async function operator() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { status: 401 as const };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("privacy_request_operator_allowed", { p_user_id: user.id });
  if (error) return { status: 503 as const };
  if (!data) return { status: 403 as const };
  return { admin, user };
}

export const GET = observeRoute("/api/privacy-requests/operator", "GET", async (request: Request) => {
  try {
    const access = await operator();
    if ("status" in access) return NextResponse.json({ error: "Privacy request queue unavailable." }, { status: access.status });
    if (new URL(request.url).searchParams.get("check") === "1") {
      return NextResponse.json({ allowed: true }, { headers: noStore });
    }
    const { data, error } = await access.admin.from("privacy_requests").select(fields)
      .in("status", ["received", "in_review"]).order("created_at", { ascending: true }).limit(100);
    if (error) throw error;
    return NextResponse.json({ requests: data }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Privacy request queue unavailable." }, { status: 503 });
  }
});

export const PATCH = observeRoute("/api/privacy-requests/operator", "PATCH", async (request: Request) => {
  try {
    const access = await operator();
    if ("status" in access) return NextResponse.json({ error: "Privacy request queue unavailable." }, { status: access.status });
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      return NextResponse.json({ error: "A same-origin request is required." }, { status: 403 });
    }
    const input = z.strictObject({ id: z.uuid(), expectedStatus: z.enum(["received", "in_review"]),
      status: z.enum(["in_review", "completed", "declined"]) }).safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Invalid status change." }, { status: 400 });
    const { data, error } = await access.admin.from("privacy_requests").update({ status: input.data.status,
      handled_by: access.user.id, updated_at: new Date().toISOString() })
      .eq("id", input.data.id).eq("status", input.data.expectedStatus).select(fields).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Request changed. Reload the queue." }, { status: 409 });
    return NextResponse.json({ request: data }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not update request status." }, { status: 503 });
  }
});