import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";
import { MetaError } from "@/lib/meta/client";
import { fetchAdAccounts, fetchPages } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** Finalise a connection by saving the chosen ad account + page. */
export async function POST(request: NextRequest) {
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

  const body = (await request.json().catch(() => ({}))) as {
    adAccountId?: string;
    pageId?: string;
  };
  const adAccountId = body.adAccountId?.trim();
  const pageId = body.pageId?.trim();
  if (!adAccountId || !pageId) {
    return NextResponse.json(
      { error: "Pick both an ad account and a page." },
      { status: 422 },
    );
  }

  const { data: row } = await supabase
    .from("meta_credentials")
    .select("access_token, token_type")
    .eq("business_id", business.id)
    .maybeSingle();
  if (!row?.access_token || row.token_type !== "oauth") {
    return NextResponse.json({ error: "Not connected" }, { status: 400 });
  }

  try {
    // Verify the selection against what the token can actually manage.
    const [adAccounts, pages] = await Promise.all([
      fetchAdAccounts(row.access_token),
      fetchPages(row.access_token),
    ]);
    if (!adAccounts.some((a) => a.id === adAccountId)) {
      return NextResponse.json(
        { error: "That ad account isn't available on this login." },
        { status: 422 },
      );
    }
    if (!pages.some((p) => p.id === pageId)) {
      return NextResponse.json(
        { error: "That page isn't available on this login." },
        { status: 422 },
      );
    }
  } catch (err) {
    const status = err instanceof MetaError ? err.status ?? 502 : 502;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }

  const { error } = await supabase
    .from("meta_credentials")
    .update({
      ad_account_id: adAccountId,
      page_id: pageId,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", business.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    businessId: business.id,
    action: "meta.account_selected",
    entityType: "business",
    entityId: business.id,
    metaObjectId: adAccountId,
    details: { adAccountId, pageId },
  });

  return NextResponse.json({ ok: true });
}
