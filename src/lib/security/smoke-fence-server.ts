import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { parseSmokeFence, SMOKE_FENCE_HEADER, type SmokeFence } from "./smoke-fence";

export const fenceSignature = (secret: string, draftIds: readonly string[]) =>
  createHmac("sha256", secret).update(`draft-only|${[...draftIds].sort().join(",")}`).digest("hex");

/** The fence for this request, or null when it carries none. Without a valid signature (or secret) no draft is owned. */
export function smokeFence(request: Request): SmokeFence | null {
  const claim = parseSmokeFence(request);
  if (!claim) return null;
  if (!claim.claimedDraftIds.length) return { ownedDraftIds: new Set() };
  const secret = getEnv().TEST_SESSION_SECRET;
  if (secret.length < 32) return { ownedDraftIds: new Set() };
  const expected = Buffer.from(fenceSignature(secret, claim.claimedDraftIds));
  const given = Buffer.from(claim.signature);
  const valid = given.length === expected.length && timingSafeEqual(given, expected);
  return { ownedDraftIds: new Set(valid ? claim.claimedDraftIds : []) };
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
