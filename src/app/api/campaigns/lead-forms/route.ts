import { NextResponse } from "next/server";
import { friendlyMetaError } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ forms: [], error: "Meta not configured" });
  }
  try {
    const context = await requireOwnedBusiness(business.id);
    const forms = await withMetaConnection(
      context,
      { purpose: "create_paused" },
      (meta) => meta.listLeadForms(),
    );
    return NextResponse.json({ forms });
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ forms: [], error: err.message });
    }
    return NextResponse.json({ forms: [], error: friendlyMetaError(err, "Could not load lead forms.") });
  }
}
