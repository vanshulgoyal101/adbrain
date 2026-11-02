import { revokeMetaGrant } from "@/lib/meta/revoke-grant";

const REVOKE_WAIT_MS = 5_000;

/**
 * #1649: before a disconnect, revoke the app's Meta grant, best effort and only where it can't cut off anyone else.
 * Waits at most 5 s and never throws; a slow revoke keeps running and logs its own outcome.
 */
export async function revokeBeforeDisconnect(businessId: string): Promise<void> {
  let bound: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    revokeMetaGrant(businessId),
    new Promise((resolve) => { bound = setTimeout(resolve, REVOKE_WAIT_MS); }),
  ]);
  clearTimeout(bound);
}
