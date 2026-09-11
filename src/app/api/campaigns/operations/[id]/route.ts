import { NextResponse } from "next/server";
import { operationDtoSchema } from "@/lib/campaign/connect-contracts";
import { getPersistedOperationStatus, operationToDTO } from "@/lib/campaign/operation-store";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import type { Blocker } from "@/lib/meta/connect-contracts";

export const runtime = "nodejs";

function errorResponse(
  requestId: string,
  status: number,
  code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "UNAVAILABLE",
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status },
  );
}

function operationBlockers(state: string): Blocker[] {
  return state === "needs_reconciliation"
    ? [{
        code: "RECONCILIATION_REQUIRED",
        message: "Campaign creation needs reconciliation before it can be retried.",
        action: { kind: "contact_admin" },
      }]
    : [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const { id } = await params;
  const { data: row, error } = await supabase
    .from("campaign_operations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return errorResponse(requestId, 404, "NOT_FOUND", "Operation not found.");

  try {
    await requireOwnedBusiness(row.business_id);
  } catch (accessError) {
    if (accessError instanceof ConnectionAccessError) {
      const status = accessError.code === "UNAUTHENTICATED"
        ? 401
        : accessError.code === "FORBIDDEN"
          ? 403
          : accessError.code === "NOT_FOUND"
            ? 404
            : 503;
      return errorResponse(
        requestId,
        status,
        status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 401 ? "UNAUTHENTICATED" : "UNAVAILABLE",
        status >= 500 ? "Operation access could not be checked." : accessError.message,
        status >= 500,
      );
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Operation access could not be checked.", true);
  }

  try {
    const operation = await getPersistedOperationStatus(row);
    const data = operationDtoSchema.parse(operationToDTO(operation, operationBlockers(operation.state)));
    return NextResponse.json({ ok: true, data, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Operation status could not be checked.", true);
  }
}