import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { MediaError, mediaUploadsEnabled } from "@/lib/media/store";

/** #1209: the signed-in owner and an untyped client for the media tables (they aren't in lib/types yet), or the error response. */
export async function mediaSession(): Promise<{ user: { id: string }; client: SupabaseClient } | NextResponse> {
  if (!mediaUploadsEnabled()) return apiError("Not found", 404);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  return { user, client: supabase as unknown as SupabaseClient };
}

export function mediaErrorResponse(error: unknown): NextResponse {
  if (error instanceof MediaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "Couldn't save the photo. Try again.", code: "MEDIA_UNAVAILABLE" }, { status: 503 });
}

/** The owner's business with its category (the rights check needs it, #784); null when it isn't theirs (RLS read). */
export async function ownedBusiness(client: SupabaseClient, businessId: string): Promise<{ id: string; vertical: string | null } | null> {
  const { data } = await client.from("businesses").select("id, vertical").eq("id", businessId).maybeSingle();
  return (data as { id: string; vertical: string | null } | null) ?? null;
}

/** The business is the owner's (RLS read). */
export async function ownsBusiness(client: SupabaseClient, businessId: string): Promise<boolean> {
  const { data } = await client.from("businesses").select("id").eq("id", businessId).maybeSingle();
  return Boolean(data);
}
