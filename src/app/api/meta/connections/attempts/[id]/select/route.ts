import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { commitSelectedConnection } from "@/lib/meta/connection-repository";
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
  const body = await request.json().catch(() => null) as {
    pairId?: unknown;
    revision?: unknown;
    confirmReplacement?: unknown;
  } | null;
  const { id } = await context.params;
  if (typeof body?.pairId !== "string" || !Number.isSafeInteger(body.revision)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "A valid candidate selection is required.", retryable: false }, requestId },
      { status: 400 },
    );
  }
  const result = await commitSelectedConnection({
    attemptId: id,
    userId: user.id,
    pairId: body.pairId,
    revision: body.revision as number,
    confirmReplacement: body.confirmReplacement === true,
  });
  if (!result) return NextResponse.json(
    { ok: false, error: { code: "CONFLICT", message: "The Meta selection is stale or unavailable.", retryable: true }, requestId },
    { status: 409 },
  );
  return NextResponse.json({ ok: true, data: result, requestId });
}