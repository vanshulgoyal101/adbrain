import { observeRoute } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import { z } from "zod";

export const runtime = "nodejs";

/** Finalise a connection by saving the chosen ad account + page. */
export const POST = observeRoute("/api/meta/connect", "POST", handlePOST);

async function handlePOST(request: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = z.object({
    businessId: z.string().trim().min(1).max(128),
    adAccountId: z.string().trim().min(1).max(128),
    pageId: z.string().trim().min(1).max(128),
  }).safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Pick both an ad account and a page." },
      { status: 422 },
    );
  }
  const { businessId, adAccountId, pageId } = body.data;

  const business = await requireOwnedBusiness(businessId);
  void business;
  void adAccountId;
  void pageId;
  return NextResponse.json(
    { error: "This selection endpoint has been replaced by the contextual connection flow." },
    { status: 410 },
  );
}
