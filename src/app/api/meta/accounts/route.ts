import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { MetaError } from "@/lib/meta/client";
import { fetchAdAccounts, fetchPages } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** List the connected user's ad accounts + pages for the selection UI. */
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
    return NextResponse.json({ error: "No business" }, { status: 400 });
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
    const [adAccounts, pages] = await Promise.all([
      fetchAdAccounts(row.access_token),
      fetchPages(row.access_token),
    ]);
    return NextResponse.json({ adAccounts, pages });
  } catch (err) {
    const status = err instanceof MetaError ? err.status ?? 502 : 502;
    return NextResponse.json(
      { error: (err as Error).message },
      { status },
    );
  }
}
