import { NextResponse } from "next/server";
import {
  draftDtoSchema,
  draftUpdateRequestSchema,
} from "@/lib/campaign/connect-contracts";
import {
  draftRecordFromRow,
  draftRecordToDTO,
  isDraftExpired,
  prepareDraftUpdate,
} from "@/lib/campaign/draft-store";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";

function errorResponse(
  requestId: string,
  status: number,
  code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "UNAVAILABLE",
  message: string,
  retryable = false,
) {
  return NextResponse.json({ ok: false, error: { code, message, retryable }, requestId }, { status });
}

async function findDraft(supabase: Awaited<ReturnType<typeof createClient>>, id: string, userId: string) {
  return supabase
    .from("campaign_drafts")
    .select("*")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
}

async function authorizeDraftBusiness(
  businessId: string,
  requestId: string,
) {
  try {
    return await requireOwnedBusiness(businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return errorResponse(requestId, status, status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNAVAILABLE", status >= 500 ? "Draft access could not be checked." : error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Draft access could not be checked.", true);
  }
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
  const { data: row, error } = await findDraft(supabase, id, user.id);
  if (error || !row) return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  const authorization = await authorizeDraftBusiness(row.business_id, requestId);
  if (authorization instanceof Response) return authorization;
  const draft = draftRecordFromRow(row);
  if (isDraftExpired(draft.expiresAt, new Date().toISOString())) {
    return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  }
  return NextResponse.json({ ok: true, data: draftDtoSchema.parse(draftRecordToDTO(draft)), requestId });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");
  const body = draftUpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse(requestId, 400, "INVALID_INPUT", "Draft update is invalid.");
  const { id } = await params;
  const { data: row, error } = await findDraft(supabase, id, user.id);
  if (error || !row) return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  const authorization = await authorizeDraftBusiness(row.business_id, requestId);
  if (authorization instanceof Response) return authorization;
  const current = draftRecordFromRow(row);
  const plan = prepareDraftUpdate({
    actor: { businessId: current.businessId, userId: user.id },
    current,
    expectedVersion: body.data.expectedVersion,
    draftInput: body.data.input,
    now: new Date().toISOString(),
  });
  if ("ok" in plan) {
    return errorResponse(requestId, plan.code === "NOT_FOUND" ? 404 : plan.code === "FORBIDDEN" ? 403 : plan.code === "CONFLICT" ? 409 : 400, plan.code, plan.message, plan.code === "CONFLICT");
  }

  const { data: rows, error: updateError } = await supabase.rpc("update_campaign_draft_if_version", {
    p_draft_id: id,
    p_business_id: current.businessId,
    p_owner_id: user.id,
    p_expected_version: plan.expectedVersion,
    p_input: plan.input as unknown as Json,
    p_now: plan.updatedAt,
  });
  if (updateError) return errorResponse(requestId, 503, "UNAVAILABLE", "Draft storage is unavailable.", true);
  const updatedRow = rows?.[0];
  if (!updatedRow) return errorResponse(requestId, 409, "CONFLICT", "Draft changed in another tab. Reload before saving.", true);
  const draft = draftRecordFromRow(updatedRow);
  return NextResponse.json({ ok: true, data: draftDtoSchema.parse(draftRecordToDTO(draft)), requestId });
}