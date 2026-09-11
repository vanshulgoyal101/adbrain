import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { getPersistedOperationStatus, operationToDTO } from "@/lib/campaign/operation-store";

export const runtime = "nodejs";
const querySchema = z.object({ businessId: z.string().uuid(), idempotencyKey: z.string().min(1).max(200) });

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store" };
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "Valid business and operation key required.", retryable: false }, requestId }, { status: 400, headers });
  try {
    await requireOwnedBusiness(parsed.data.businessId);
    const supabase = await createClient();
    const { data, error } = await supabase.from("campaign_operations").select("*")
      .eq("business_id", parsed.data.businessId).eq("kind", "campaign_create")
      .eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
    if (error) throw new Error("Operation lookup failed.");
    return NextResponse.json({ ok: true, data: data ? operationToDTO(await getPersistedOperationStatus(data)) : null, requestId }, { headers });
  } catch (error) {
    const code = error instanceof ConnectionAccessError ? error.code : "UNAVAILABLE";
    const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 503;
    return NextResponse.json({ ok: false, error: { code, message: "Campaign operation could not be read.", retryable: status >= 500 }, requestId }, { status, headers });
  }
}