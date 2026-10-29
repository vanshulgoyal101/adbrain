import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import type { Creative, Database } from "@/lib/types";

/**
 * Recover persisted variants without starting another paid generation request.
 */
export async function recoverGeneration(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const businessId = params.get("businessId")?.trim() ?? "";
  const generationId = params.get("generationId")?.trim() ?? "";
  const requestedCount = params.has("expectedCount") ? Number(params.get("expectedCount")) : null;
  if (!businessId || !z.string().uuid().safeParse(generationId).success ||
    (requestedCount !== null && (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 6))) {
    return NextResponse.json({ error: "A valid businessId, generationId, and expectedCount are required." }, { status: 400 });
  }
  const limited = await rateLimitResponse(`generate-status:${user.id}`, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;
  let intent: Database["public"]["Functions"]["creative_generation_status"]["Returns"];
  try {
    const lookup = await createAdminClient().rpc("creative_generation_status", {
      p_business_id: businessId, p_user_id: user.id, p_generation_id: generationId,
    });
    if (lookup.error || !lookup.data) return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });
    intent = lookup.data;
  } catch {
    return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });
  }
  if (intent.status === "unknown") return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  const expectedCount = Number(intent.expectedCount);
  if (requestedCount !== null && requestedCount !== expectedCount)
    return NextResponse.json({ error: "Generation count does not match the saved request." }, { status: 409 });

  const { data: creatives, error } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .eq("variant_group", generationId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });

  const saved = (creatives ?? []) as Creative[];
  let status: string = intent.status === "complete" && saved.length < expectedCount ? "unresolved" :
    intent.status === "processing" && saved.length ? "partial" : intent.status;
  // #1407: the closing audit row settles a short batch immediately, rather than after the intent times out.
  if ((status === "partial" || status === "processing") && saved.length < expectedCount) {
    const { data: closed } = await supabase.from("audit_log").select("id").eq("business_id", businessId)
      .eq("action", "creatives.generate").eq("details->>variantGroup", generationId).limit(1);
    if (closed?.length) status = "ended";
  }
  return NextResponse.json({
    status,
    creatives: saved,
    count: saved.length,
    expectedCount,
  });
}
