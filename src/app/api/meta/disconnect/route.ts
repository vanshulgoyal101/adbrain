import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

/** Remove a business's stored Meta (OAuth) connection. */
export async function POST(request?: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = request ? await request.json().catch(() => null) as { businessId?: unknown } | null : null;
  const requestedBusinessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
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
}
