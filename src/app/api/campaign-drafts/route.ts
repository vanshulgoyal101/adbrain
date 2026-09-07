import { NextResponse } from "next/server";
import { draftInputSchema, draftDtoSchema } from "@/lib/campaign/connect-contracts";
import {
  DRAFT_TTL_MS,
  MAX_ACTIVE_DRAFTS,
  draftRecordFromRow,
  draftRecordToDTO,
  prepareDraftCreate,
} from "@/lib/campaign/draft-store";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";

function responseError(
  requestId: string,
  status: number,
  code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "UNAVAILABLE",
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status },
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responseError(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const input = draftInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return responseError(requestId, 400, "INVALID_INPUT", "Draft input is invalid.");
  if (input.data.businessId === "") return responseError(requestId, 400, "INVALID_INPUT", "A valid business is required.");

  let actor;
  try {
    actor = await requireOwnedBusiness(input.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return responseError(requestId, status, error.code === "NOT_FOUND" ? "FORBIDDEN" : error.code, error.message, status >= 500);
    }
    return responseError(requestId, 503, "UNAVAILABLE", "Business access could not be checked.", true);
  }

  const now = new Date().toISOString();
  const plan = prepareDraftCreate({ actor, draftInput: input.data, now, ttlMs: DRAFT_TTL_MS });
  if ("ok" in plan) {
    return responseError(requestId, plan.code === "FORBIDDEN" ? 403 : plan.code === "CONFLICT" ? 409 : 400, plan.code, plan.message, plan.code === "CONFLICT");
  }

  const { data: activeRows, error: countError } = await supabase
    .from("campaign_drafts")
    .select("id")
    .eq("business_id", actor.businessId)
    .eq("owner_id", actor.userId)
    .gt("expires_at", now);
  if (countError) return responseError(requestId, 503, "UNAVAILABLE", "Draft storage is unavailable.", true);
  if ((activeRows ?? []).length >= MAX_ACTIVE_DRAFTS) {
    return responseError(requestId, 409, "CONFLICT", "Draft limit reached. Finish or remove an existing draft first.");
  }

  const { data: row, error } = await supabase
    .from("campaign_drafts")
    .insert({
      business_id: plan.businessId,
      owner_id: plan.ownerId,
      version: plan.version,
      input: plan.input as unknown as Json,
      expires_at: plan.expiresAt,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    })
    .select("*")
    .single();
  if (error || !row) return responseError(requestId, 503, "UNAVAILABLE", "Draft storage is unavailable.", true);

  const draft = draftDtoSchema.parse(draftRecordToDTO(draftRecordFromRow(row)));
  return NextResponse.json({ ok: true, data: draft, requestId });
}