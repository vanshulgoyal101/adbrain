import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { leadUpdateSchema } from "@/lib/leads/filters";
import { observeRoute } from "@/lib/observability/logger";

export const PATCH = observeRoute("/api/leads/[id]", "PATCH", async (
  request: Request, context: { params: Promise<{ id: string }> },
) => {
  try {
    const database = await createClient();
    const { data: { user } } = await database.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const id = z.uuid().parse((await context.params).id);
    const update = leadUpdateSchema.parse(await request.json());
    const business = await getPrimaryBusiness();
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    const { contacted, ...fields } = update;
    if (contacted) {
      // #1049: the first tap only; later taps keep the first time. A new enquiry becomes "contacted".
      // #1140: only a still-new enquiry gets a first reply time, so a tap on an older lead can't record weeks as a reply.
      const now = new Date().toISOString();
      const first = await database.from("leads").update({ first_contacted_at: now, workflow_status: "contacted" })
        .eq("id", id).eq("business_id", business.id).eq("workflow_status", "new").is("first_contacted_at", null);
      const status = await database.from("leads").update({ workflow_status: "contacted" })
        .eq("id", id).eq("business_id", business.id).eq("workflow_status", "new");
      if (first.error || status.error) throw new Error("Save failed");
    }
    const query = Object.keys(fields).length
      ? database.from("leads").update(fields).eq("id", id).eq("business_id", business.id).select("*").maybeSingle()
      : database.from("leads").select("*").eq("id", id).eq("business_id", business.id).maybeSingle();
    const { data, error } = await query;
    if (error) throw new Error("Save failed");
    if (!data) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
    return NextResponse.json({ lead: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? "Invalid follow-up." : "Follow-up could not be saved." }, { status: invalid ? 400 : 503 });
  }
});