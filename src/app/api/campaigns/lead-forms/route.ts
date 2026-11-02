import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { friendlyMetaError } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { cachedLeadForms } from "@/lib/meta/lead-form-cache";
import { ownerError } from "@/i18n/request-locale";

export const runtime = "nodejs";

export const GET = observeRoute("/api/campaigns/lead-forms", "GET", handleGET);

async function handleGET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ forms: [], error: await ownerError("setUpBrandFirst") });
  }
  try {
    const context = await requireOwnedBusiness(business.id);
    const forms = await withMetaConnection(
      context,
      { purpose: "create_paused" },
      (meta, connection) => cachedLeadForms(meta, connection, { fresh: new URL(request.url).searchParams.get("fresh") === "1" }),
    );
    return NextResponse.json({ forms });
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ forms: [], error: err.message });
    }
    return NextResponse.json({ forms: [], error: friendlyMetaError(err, await ownerError("leadFormsUnavailable")) });
  }
}
