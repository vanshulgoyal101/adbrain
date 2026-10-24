import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignDestination } from "@/lib/campaign/outcomes";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const enquirySchema = z.strictObject({ name: optionalText(200), phone: optionalText(40), note: optionalText(2000) });

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
  const { error } = await database.from("leads").insert({
    business_id: campaign.business_id,
    campaign_id: campaign.id,
    source: "whatsapp_manual",
    full_name: input.name || null,
    phone: input.phone || null,
    follow_up_note: input.note ?? "",
    created_time: new Date().toISOString(),
  }).select("id").single();
  if (error) return NextResponse.json({ error: "The enquiry could not be saved. Try again." }, { status: 503 });
  const { count } = await database.from("leads").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id).eq("source", "whatsapp_manual");
  return NextResponse.json({ enquiries: count ?? null }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});
