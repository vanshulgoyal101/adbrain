import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnectionAttempt } from "@/lib/meta/connection-repository";
import { retryConnectionDiscovery } from "@/lib/meta/retry-discovery";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const requestId = crypto.randomUUID();
  if (!user) return NextResponse.json(
    { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in required.", retryable: false }, requestId },
    { status: 401 },
  );
  if (!canUseMetaConnect(user.id)) return NextResponse.json(
    { ok: false, error: { code: "FORBIDDEN", message: "Meta connection is not enabled for this account.", retryable: false }, requestId },
    { status: 403 },
  );
  const body = await request.json().catch(() => null) as { revision?: unknown } | null;
  const { id } = await context.params;
  if (!Number.isSafeInteger(body?.revision)) return NextResponse.json(
    { ok: false, error: { code: "INVALID_INPUT", message: "A valid attempt revision is required.", retryable: false }, requestId },
    { status: 400 },
  );
  const attempt = await getConnectionAttempt(id, user.id);
  if (!attempt || attempt.revision !== body?.revision || !["failed", "action_required"].includes(attempt.state)) {
    return NextResponse.json(
      { ok: false, error: { code: "CONFLICT", message: "The connection attempt is stale or cannot be retried.", retryable: true }, requestId },
      { status: 409 },
    );
  }
  const updated = await retryConnectionDiscovery(id, user.id, attempt.revision);
  if (!updated) return NextResponse.json(
    { ok: false, error: { code: "CONFLICT", message: "The connection attempt changed during retry.", retryable: true }, requestId },
    { status: 409 },
  );
  return NextResponse.json({ ok: true, data: updated, requestId });
}