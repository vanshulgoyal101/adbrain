import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

/** Save a business's spend guardrail settings. */
export const POST = observeRoute("/api/spend-limits", "POST", handlePOST);

async function handlePOST(request: Request) {
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

  const parsed = z.object({
    weeklyCapRupees: z.number().int().positive().max(2_147_483_647).nullable(),
    alertPct: z.number().int().min(1).max(100),
    autoPause: z.boolean(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a positive whole-rupee cap (or null for no cap), a whole-number threshold from 1 to 100, and a boolean auto-pause setting." }, { status: 422 });
  }
  const body = parsed.data;

  const cap = body.weeklyCapRupees;
  const alertPct = body.alertPct;

  const { error } = await supabase.from("spend_limits").upsert(
    {
      business_id: business.id,
      weekly_cap_rupees: cap,
      alert_pct: alertPct,
      auto_pause: body.autoPause === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (error) {
    return NextResponse.json({ error: "Could not save spend limits." }, { status: 500 });
  }

  await logEvent({
    businessId: business.id,
    action: "spend.limits_updated",
    entityType: "business",
    entityId: business.id,
    details: { weeklyCapRupees: cap, alertPct, autoPause: body.autoPause === true },
  });

  return NextResponse.json({ ok: true });
}
