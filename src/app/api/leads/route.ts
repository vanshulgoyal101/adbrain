import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { getLeadPage } from "@/lib/leads/queries";
import { observeRoute } from "@/lib/observability/logger";
import { logEvent } from "@/lib/audit";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { OWNER_ERRORS } from "@/lib/copy/owner-words";

export const GET = observeRoute("/api/leads", "GET", async (request: Request) => {
  try {
    const database = await createClient();
    const { data: { user } } = await database.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const business = await getPrimaryBusiness();
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    const page = await getLeadPage(business.id, Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? "Invalid enquiry filters." : "We couldn't load your enquiries. Reload the page." }, { status: invalid ? 400 : 503 });
  }
});

/** #1761: the owner deletes every enquiry of one of their campaigns (see DELETE /api/leads/[id]). */
export const DELETE = observeRoute("/api/leads", "DELETE", async (request: Request) => {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const campaignId = z.uuid().safeParse(new URL(request.url).searchParams.get("campaignId"));
  if (!campaignId.success) return NextResponse.json({ error: "Choose a campaign." }, { status: 400 });
  const limited = await rateLimitResponse(`lead-erase:${user.id}`, { limit: 60, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const business = await getPrimaryBusiness();
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
  const { data: campaign } = await database.from("campaigns").select("id").eq("id", campaignId.data).eq("business_id", business.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: OWNER_ERRORS.campaignNotFound }, { status: 404 });
  const { data, error } = await database.rpc("leads_erase", { p_business_id: business.id, p_campaign_id: campaignId.data });
  if (error) return NextResponse.json({ error: "The enquiries couldn't be deleted. Try again." }, { status: 503 });
  await logEvent({ businessId: business.id, action: "leads.deleted", entityType: "campaign", entityId: campaignId.data, details: { count: data ?? 0 } });
  return NextResponse.json({ ok: true, deleted: data ?? 0 });
});

