import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import type { LLMUsageEvent } from "@/lib/llm/persist";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { adPhotos, describeUsageEvent, pickedMedia, readAdPhotos, type AdPhoto, type ReadPhoto } from "@/lib/media/ad-photos";
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

/**
 * #780: the owner's picked library photos for Create, signed and read, or the error response. Runs before the paid
 * batch is admitted, so a photo that can't be read is refused there instead of stranding a hold.
 */
export async function readPickedPhotos(client: SupabaseClient, businessId: string, ids: readonly string[]): Promise<ReadPhoto[] | NextResponse> {
  if (!mediaUploadsEnabled()) return apiError("Not found", 404);
  try {
    return await readAdPhotos(createAdminClient() as unknown as SupabaseClient, await pickedMedia(client, businessId, ids));
  } catch (error) {
    if (error instanceof MediaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

/** #780: each read photo's notes (one vision call per new photo) and that call's usage rows. Never throws. */
export async function describePickedPhotos(
  admin: SupabaseClient,
  photos: readonly ReadPhoto[],
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId" | "generationId">,
): Promise<{ photos: AdPhoto[]; events: LLMUsageEvent[] }> {
  const events: LLMUsageEvent[] = [];
  if (!photos.length) return { photos: [], events };
  const described = await adPhotos(admin, photos, { onAttempt: (attempt, mediaId) => events.push(describeUsageEvent(attempt, mediaId, context)) });
  return { photos: described, events };
}
