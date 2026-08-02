import { NextResponse } from "next/server";
import { generateVariants } from "@/lib/creative/generate";
import { persistCreativeImage } from "@/lib/creative/persist";
import { NoLLMKeysError } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    businessId?: string;
    brief?: string;
    count?: number;
  } | null;

  const businessId = (body?.businessId ?? "").trim();
  const brief = (body?.brief ?? "").trim();
  const count = Number(body?.count ?? 3);

  if (!businessId || !brief) {
    return NextResponse.json(
      { error: "businessId and brief are required" },
      { status: 400 },
    );
  }

  // RLS ensures the user can only read their own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  let variants;
  try {
    variants = await generateVariants({ brand: business, brief, count });
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json(
        { error: err.message, code: "NO_LLM_KEYS" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  const variantGroup = crypto.randomUUID();
  const persisted = await Promise.all(
    variants.map(async (v) => ({
      ...v,
      imageUrl: await persistCreativeImage(
        supabase,
        businessId,
        variantGroup,
        v.angleId,
        v.imageUrl,
      ),
    })),
  );
  const rows = persisted.map((v) => ({
    business_id: businessId,
    brief,
    angle: v.angleName,
    image_url: v.imageUrl,
    headline: v.headline,
    primary_text: v.primaryText,
    cta: v.cta,
    variant_group: variantGroup,
    status: "draft" as const,
  }));

  const { data: inserted, error } = await supabase
    .from("creatives")
    .insert(rows)
    .select("*");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ variantGroup, creatives: inserted ?? [] });
}
