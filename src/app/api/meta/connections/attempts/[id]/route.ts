import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnectionAttempt } from "@/lib/meta/connection-repository";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in required.", retryable: false }, requestId: crypto.randomUUID() },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { id } = await context.params;
  const attempt = await getConnectionAttempt(id, user.id);
  if (!attempt) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Connection attempt not found.", retryable: false }, requestId: crypto.randomUUID() },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, data: attempt, requestId: crypto.randomUUID() },
    { headers: { "Cache-Control": "no-store" } },
  );
}