import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";

export const runtime = "nodejs";

/** List the connected user's ad accounts + pages for the selection UI. */
export async function GET(request?: Request) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const businessId = request
    ? new URL(request.url).searchParams.get("businessId")?.trim()
    : undefined;
  if (!businessId) return NextResponse.json({ error: "Business is required." }, { status: 400 });
  await requireOwnedBusiness(businessId);
  return NextResponse.json(
    { error: "This discovery endpoint has been replaced by the contextual connection flow." },
    { status: 410 },
  );
}
