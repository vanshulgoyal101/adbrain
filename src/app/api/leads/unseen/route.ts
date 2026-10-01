import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const GET = observeRoute("/api/leads/unseen", "GET", async (request: Request) => {
  try {
    const database = await createClient();
    const { data: { user } } = await database.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const business = await getPrimaryBusiness();
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const since = params.get("since");
    if (params.size !== 1 || !since || !z.iso.datetime().safeParse(since).success) {
      return NextResponse.json({ error: "Invalid viewed time." }, { status: 400 });
    }
    const { count, error } = await database.from("leads").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).gt("created_at", since);
    if (error || typeof count !== "number") throw new Error("Count unavailable");
    return NextResponse.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Enquiry count unavailable." }, { status: 503 });
  }
});