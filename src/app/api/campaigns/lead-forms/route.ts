import { NextResponse } from "next/server";
import { metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ forms: [], error: "Meta not configured" });
  }
  try {
    const forms = await meta.listLeadForms();
    return NextResponse.json({ forms });
  } catch (err) {
    return NextResponse.json({ forms: [], error: (err as Error).message });
  }
}
