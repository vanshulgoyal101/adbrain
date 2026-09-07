import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: "Campaign sync is unavailable until account binding storage is enabled. Reconnect or use the campaign review flow.",
    },
    { status: 503 },
  );
}
