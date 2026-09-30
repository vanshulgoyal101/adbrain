import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { preferenceCategories } from "@/lib/preferences/context";
import { readPreferenceState } from "@/lib/preferences/store";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const inputSchema = z.object({
  businessId: z.uuid(),
  operation: z.enum(["enable", "pause", "save", "forget", "clear"]),
  expectedEpoch: z.number().int().min(0),
  category: z.enum(preferenceCategories).optional(),
  value: z.string().trim().min(1).max(160).optional(),
}).strict().refine(input => input.operation !== "save" || (input.category && input.value), "Choose a category and a preference.")
  .refine(input => input.operation !== "forget" || input.category, "Choose a category to forget.");

export const GET = observeRoute("/api/preferences", "GET", async (req: Request) => {
  const businessId = new URL(req.url).searchParams.get("businessId");
  if (!businessId || !z.uuid().safeParse(businessId).success) return NextResponse.json({ error: "Invalid business." }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: business } = await client.from("businesses").select("id").eq("id", businessId).eq("owner_id", user.id).maybeSingle();
  if (!business) return NextResponse.json({ error: "Business unavailable." }, { status: 404 });
  try {
    return NextResponse.json(await readPreferenceState(businessId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Preferences are temporarily unavailable." }, { status: 503 });
  }
});

export const POST = observeRoute("/api/preferences", "POST", async (req: Request) => {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimitResponse(`preferences:${user.id}`, { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preference request." }, { status: 400 });
  const { businessId, operation, expectedEpoch, category, value } = parsed.data;
  const { error } = await client.rpc("change_declared_preferences", {
    p_business_id: businessId, p_operation: operation, p_expected_epoch: expectedEpoch,
    p_category: category ?? null, p_value: value ?? null,
  });
  if (error) return NextResponse.json({ error: error.code === "40001" ? "Preferences changed. Reload before saving." :
    error.code === "42501" ? "Business unavailable." : error.code === "22023" ? error.message : "Could not save preferences." },
  { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503 });
  try {
    return NextResponse.json(await readPreferenceState(businessId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved, but the updated preferences could not be loaded. Refresh to confirm." }, { status: 503 });
  }
});