import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

/** Remove a business's stored Meta (OAuth) connection. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business" }, { status: 400 });
  }

  const { error } = await supabase
    .from("meta_credentials")
    .delete()
    .eq("business_id", business.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    businessId: business.id,
    action: "meta.disconnected",
    entityType: "business",
    entityId: business.id,
  });

  return NextResponse.json({ ok: true });
}
