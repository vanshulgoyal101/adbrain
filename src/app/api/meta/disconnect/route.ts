import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

/** Remove a business's stored Meta (OAuth) connection. */
export const POST = observeRoute("/api/meta/disconnect", "POST", handlePOST);

async function handlePOST(request?: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = request ? await request.text() : "";
  let requestedBusinessId = "";
  if (rawBody) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "A valid business is required." }, { status: 400 });
    }
    const body = z.object({ businessId: z.string().uuid() }).safeParse(parsedBody);
    if (!body.success) return NextResponse.json({ error: "A valid business is required." }, { status: 400 });
    requestedBusinessId = body.data.businessId;
  }
  try {
    const legacyBusiness = !requestedBusinessId ? await getPrimaryBusiness() : null;
    const businessId = requestedBusinessId || legacyBusiness?.id || "";
    if (!businessId) return NextResponse.json({ error: "Business is required." }, { status: 400 });
    const business = requestedBusinessId
      ? await requireOwnedBusiness(businessId)
      : { businessId };
    const admin = createAdminClient();
    const { data: disconnected, error } = await admin.rpc("meta_disconnect", {
      p_business_id: business.businessId,
      p_user_id: user.id,
    });
    if (error || !disconnected) {
      return NextResponse.json({ error: "Could not disconnect the Meta connection." }, { status: 500 });
    }

    await logEvent({
      businessId: business.businessId,
      action: "meta.disconnected",
      entityType: "business",
      entityId: business.businessId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof ConnectionAccessError
      ? { UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 503 }[error.code]
      : 503;
    return NextResponse.json({ error: error instanceof ConnectionAccessError ? error.message : "Could not disconnect the Meta connection." }, { status });
  }
}
