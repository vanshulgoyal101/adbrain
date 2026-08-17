import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

/** Save a business's spend guardrail settings. */
export async function POST(request: Request) {
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
    weeklyCapRupees?: number | null;
    alertPct?: number;
    autoPause?: boolean;
  };

  let cap: number | null = null;
  if (body.weeklyCapRupees != null) {
    const n = Math.round(Number(body.weeklyCapRupees));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "Weekly cap must be a positive amount or empty." },
        { status: 422 },
      );
    }
    cap = n > 0 ? n : null;
  }

  const alertPct = Math.round(Number(body.alertPct ?? 80));
  if (!Number.isFinite(alertPct) || alertPct < 1 || alertPct > 100) {
    return NextResponse.json(
      { error: "Alert threshold must be between 1 and 100." },
      { status: 422 },
    );
  }

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
