import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignDestination } from "@/lib/campaign/outcomes";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) => z.string().trim().max(max).optional();
// #798: `customer: true` logs a chat that became a customer in one tap (no details needed).
const enquirySchema = z.strictObject({ name: optionalText(200), phone: optionalText(40), note: optionalText(2000), customer: z.literal(true).optional() });

/** The campaign's logged WhatsApp enquiries, its customers and its bookings (#1994: booked or customer; any source), after a change. */
async function counts(database: Awaited<ReturnType<typeof createClient>>, campaignId: string) {
  const [enquiries, customers, booked] = await Promise.all([
    database.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("source", "whatsapp_manual"),
    database.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("workflow_status", "customer"),
    database.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("workflow_status", ["booked", "customer"]),
  ]);
  return { enquiries: enquiries.count ?? null, customers: customers.count ?? null, booked: booked.count ?? null };
}

/**
 * #335: the owner logs a real enquiry from a WhatsApp ad's chats. It goes into Enquiries with the
 * campaign, so results can show cost per real enquiry. RLS ("leads: all own") scopes the write.
 */
export const POST = observeRoute("/api/campaigns/[id]/enquiries", "POST", async (
  request: Request, context: { params: Promise<{ id: string }> },
) => {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  let id: string;
  let input: z.infer<typeof enquirySchema>;
  try {
    id = z.uuid().parse((await context.params).id);
    input = enquirySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid enquiry." }, { status: 400 });
  }
  const limited = await rateLimitResponse(`manual-enquiry:${user.id}`, { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;

  const { data: campaign } = await database.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (campaignDestination(campaign) !== "whatsapp") {
    return NextResponse.json({ error: "Real enquiries can be logged on WhatsApp campaigns only." }, { status: 400 });
  }
  const { data: saved, error } = await database.from("leads").insert({
    business_id: campaign.business_id,
    campaign_id: campaign.id,
    source: "whatsapp_manual",
    full_name: input.name || null,
    phone: input.phone || null,
    follow_up_note: input.note ?? "",
    created_time: new Date().toISOString(),
    ...(input.customer ? { workflow_status: "customer" as const } : {}),
  }).select("id").single();
  if (error || !saved) return NextResponse.json({ error: "The enquiry could not be saved. Try again." }, { status: 503 });
  return NextResponse.json({ id: saved.id, ...await counts(database, campaign.id) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});

/**
 * #798: Undo for a logged enquiry (`?lead=<id>`): removes only a WhatsApp enquiry the owner logged on this
 * campaign; Meta form enquiries are never deleted here. RLS scopes the delete to the owner's rows.
 */
export const DELETE = observeRoute("/api/campaigns/[id]/enquiries", "DELETE", async (
  request: Request, context: { params: Promise<{ id: string }> },
) => {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  let id: string, lead: string;
  try {
    id = z.uuid().parse((await context.params).id);
    lead = z.uuid().parse(new URL(request.url).searchParams.get("lead"));
  } catch {
    return NextResponse.json({ error: "Invalid enquiry." }, { status: 400 });
  }
  const limited = await rateLimitResponse(`manual-enquiry:${user.id}`, { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const { data: removed, error } = await database.from("leads").delete()
    .eq("id", lead).eq("campaign_id", id).eq("source", "whatsapp_manual").select("id");
  if (error) return NextResponse.json({ error: "The enquiry could not be removed. Try again." }, { status: 503 });
  if (!removed?.length) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
  return NextResponse.json(await counts(database, id), { headers: { "Cache-Control": "private, no-store" } });
});
