import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { META_TEST_LEAD_PATTERN } from "@/lib/leads/test-lead";
import { ownerError } from "@/i18n/request-locale";

export const GET = observeRoute("/api/leads/unseen", "GET", async (request: Request) => {
  try {
    const database = await createClient();
    const { data: { user } } = await database.auth.getUser();
    if (!user) return NextResponse.json({ error: await ownerError("signInRequired") }, { status: 401 });
    const business = await getPrimaryBusiness();
    if (!business) return NextResponse.json({ error: await ownerError("businessMissing") }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const since = params.get("since");
    if (params.size !== 1 || !since || !z.iso.datetime().safeParse(since).success) {
      return NextResponse.json({ error: "Invalid viewed time." }, { status: 400 });
    }
    const unseen = () => database.from("leads").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).gt("created_at", since);
    // #1149: Meta's test leads never count, the same as Home.
    const [all, tests] = await Promise.all([unseen(), unseen().ilike("full_name", META_TEST_LEAD_PATTERN)]);
    if (all.error || typeof all.count !== "number" || tests.error || typeof tests.count !== "number") throw new Error("Count unavailable");
    return NextResponse.json({ count: Math.max(0, all.count - tests.count) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: await ownerError("enquiryCountUnavailable") }, { status: 503 });
  }
});