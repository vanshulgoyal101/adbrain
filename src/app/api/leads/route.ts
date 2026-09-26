import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { getLeadPage } from "@/lib/leads/queries";
import { observeRoute } from "@/lib/observability/logger";

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
    return NextResponse.json({ error: invalid ? "Invalid enquiry filters." : "Enquiries could not be loaded." }, { status: invalid ? 400 : 503 });
  }
});