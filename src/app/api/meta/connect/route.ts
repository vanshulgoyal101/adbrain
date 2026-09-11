import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";

export const runtime = "nodejs";

/** Finalise a connection by saving the chosen ad account + page. */
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    businessId?: string;
    adAccountId?: string;
    pageId?: string;
  };
  const businessId = body.businessId?.trim();
  const adAccountId = body.adAccountId?.trim();
  const pageId = body.pageId?.trim();
  if (!businessId || !adAccountId || !pageId) {
    return NextResponse.json(
      { error: "Pick both an ad account and a page." },
      { status: 422 },
    );
  }

  const business = await requireOwnedBusiness(businessId);
  void business;
  void adAccountId;
  void pageId;
  return NextResponse.json(
    { error: "This selection endpoint has been replaced by the contextual connection flow." },
    { status: 410 },
  );
}
