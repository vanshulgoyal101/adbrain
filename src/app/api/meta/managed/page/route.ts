import { observeRoute, currentRequestId, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { adminPages, linkManagedPage, META_PAGE_CREATE_URL, type ManagedAccountStore } from "@/lib/meta/managed-page";

export const runtime = "nodejs";

// #523 (2-Tier): the customer's Page for their managed child business. Off unless MANAGED_ACCOUNTS_ENABLED.
export const GET = observeRoute("/api/meta/managed/page", "GET", handleGET);
export const POST = observeRoute("/api/meta/managed/page", "POST", handlePOST);

const uuid = z.string().uuid();
const postSchema = z.object({ attemptId: uuid, pageId: z.string().regex(/^[0-9]{1,24}$/) });

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 }, requestId: currentRequestId() }, { status });
}

async function ownedAttempt(attemptId: string) {
  if (!getEnv().MANAGED_ACCOUNTS_ENABLED) return { ok: false as const, response: fail(404, "NOT_ENABLED", "Managed accounts are not enabled.") };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: fail(401, "UNAUTHENTICATED", "Sign in required.") };
  if (!canUseMetaConnect(user.id)) return { ok: false as const, response: fail(403, "FORBIDDEN", "Meta connection is not enabled for this account.") };
  const { data, error } = await createAdminClient().rpc("meta_attempt_get", { p_attempt_id: attemptId, p_user_id: user.id });
  const attempt = data?.[0];
  if (error || !attempt) return { ok: false as const, response: fail(404, "NOT_FOUND", "Connection attempt not found.") };
  // As Connect does: an expired attempt's Page rights may be stale, and the business must still be the caller's.
  if (new Date(attempt.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, response: fail(410, "ATTEMPT_EXPIRED", "This Facebook connection has expired. Connect Facebook again to choose your Page.") };
  }
  try {
    await requireOwnedBusiness(attempt.business_id);
  } catch {
    return { ok: false as const, response: fail(404, "NOT_FOUND", "Connection attempt not found.") };
  }
  return { ok: true as const, attempt: { businessId: attempt.business_id as string, snapshot: attempt.discovered_assets as unknown } };
}

function store(businessId: string): ManagedAccountStore {
  const admin = createAdminClient();
  const table = () => admin.from("managed_meta_accounts");
  return {
    get: async () => {
      const { data, error } = await table().select("business_id,state,page_id,child_business_id").eq("business_id", businessId).maybeSingle();
      if (error) throw new Error("Managed account could not be read.");
      return data;
    },
    insert: async (values) => { const { error } = await table().insert(values); if (error) throw Object.assign(new Error("Managed account could not be saved."), { code: error.code }); },
    update: async (values) => { const { error } = await table().update(values).eq("business_id", businessId); if (error) throw Object.assign(new Error("Managed account could not be saved."), { code: error.code }); },
    event: async (values) => { const { error } = await admin.from("managed_meta_account_events").insert(values); if (error) throw new Error("Managed account step could not be logged."); },
    hasEvent: async (id, step, metaObjectId) => {
      const { count, error } = await admin.from("managed_meta_account_events").select("id", { count: "exact", head: true })
        .eq("business_id", id).eq("step", step).eq("meta_object_id", metaObjectId).eq("outcome", "succeeded");
      if (error) throw new Error("Managed account steps could not be read.");
      return (count ?? 0) > 0;
    },
  };
}

async function handleGET(request: NextRequest) {
  const attemptId = uuid.safeParse(request.nextUrl.searchParams.get("attemptId"));
  if (!attemptId.success) return fail(400, "INVALID_INPUT", "A connection attempt is required.");
  const owned = await ownedAttempt(attemptId.data);
  if (!owned.ok) return owned.response;
  const linked = await store(owned.attempt.businessId).get(owned.attempt.businessId).catch(() => null);
  return NextResponse.json({
    ok: true,
    data: {
      pages: adminPages(owned.attempt.snapshot),
      createUrl: META_PAGE_CREATE_URL,
      linked: linked?.page_id ? { pageId: linked.page_id, state: linked.state } : null,
    },
    requestId: currentRequestId(),
  });
}

async function handlePOST(request: NextRequest) {
  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "INVALID_INPUT", "Choose a Facebook Page.");
  const owned = await ownedAttempt(body.data.attemptId);
  if (!owned.ok) return owned.response;
  const { businessId, snapshot } = owned.attempt;
  try {
    const result = await linkManagedPage(store(businessId), { businessId, pageId: body.data.pageId, snapshot, requestId: currentRequestId() });
    recordProductEvent({ kind: "workflow", name: "managed.page_link", businessId, outcome: result.ok ? "success" : "rejected", attributes: result.ok ? {} : { errorCode: result.code } });
    if (!result.ok) {
      return fail(409, result.code, {
        PAGE_NOT_ADMIN: "You need to be an admin of this Page. Choose a Page you manage, or create one on Facebook.",
        PAGE_LOCKED: "Your ad business already uses another Page. Contact AdBrain to change it.",
        PAGE_TAKEN: "Another AdBrain business already uses this Page. Choose a different Page, or contact AdBrain.",
      }[result.code]);
    }
    return NextResponse.json({ ok: true, data: result, requestId: currentRequestId() });
  } catch {
    recordProductEvent({ kind: "workflow", name: "managed.page_link", businessId, outcome: "failed", attributes: { errorCode: "STORE_FAILED" } });
    return fail(503, "STORE_FAILED", "Your Page couldn't be saved. Try again.");
  }
}
