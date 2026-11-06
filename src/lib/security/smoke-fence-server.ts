import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { FENCE_CAPABILITY_TTL_MS, parseSmokeFence, SMOKE_FENCE_HEADER, type SmokeFence } from "./smoke-fence";

const sign = (secret: string, userId: string, draftId: string, expiresAt: number) =>
  createHmac("sha256", secret).update(`fence-draft|${userId}|${draftId}|${expiresAt}`).digest("hex");

const usableSecret = () => {
  const key = getEnv().SUPABASE_SERVICE_ROLE_KEY;
  return key && key.length >= 32
    ? createHmac("sha256", key).update("adbrain:smoke-fence-capability:v1").digest("base64url")
    : null;
};

/** The capability for a draft a fenced request just created, or null when the request is not fenced or no secret is set. */
export function issueDraftCapability(request: Request, userId: string, draftId: string, createdAt: string): string | null {
  const secret = usableSecret();
  const created = Date.parse(createdAt);
  if (!secret || !request.headers.has(SMOKE_FENCE_HEADER) || Number.isNaN(created)) return null;
  const expiresAt = created + FENCE_CAPABILITY_TTL_MS;
  return `${draftId}.${expiresAt}.${sign(secret, userId, draftId, expiresAt)}`;
}

/** The fence for this request, or null when it carries none. Drafts are owned only through live capabilities issued to this user. */
export function smokeFence(request: Request, userId?: string): SmokeFence | null {
  const claim = parseSmokeFence(request);
  if (!claim) return null;
  const owned = new Map<string, number>();
  const secret = usableSecret();
  if (secret && userId) {
    for (const { id, expiresAt, signature } of claim.claims) {
      const expected = Buffer.from(sign(secret, userId, id, expiresAt));
      const given = Buffer.from(signature);
      if (expiresAt > Date.now() && given.length === expected.length && timingSafeEqual(given, expected)) owned.set(id, expiresAt);
    }
  }
  return { ownedDraftIds: new Set(owned.keys()), capabilityExpiry: owned };
}

/** Any request under the fence, however deep the call (route or server component), leaves a Meta connection's state alone. Outside a request (cron, worker) it is false. */
export async function requestIsFenced(): Promise<boolean> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).has(SMOKE_FENCE_HEADER);
  } catch {
    return false;
  }
}
