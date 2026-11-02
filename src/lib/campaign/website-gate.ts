import { isInternalUser, type AccountIdentity } from "@/lib/internal-accounts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * #2688 (CTO on #2595): website ads stay internal-only on plan, Review and launch until the CEO opens them.
 * The composer hides the choice (#2660), but a UI gate is not a boundary. Remove this file when website opens.
 */
export function websiteOpenFor(user: AccountIdentity): boolean {
  return isInternalUser(user);
}

/** The worker has no session: the draft owner's account decides, read with the service role. */
export async function websiteOpenForOwner(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
  return !error && websiteOpenFor(data.user);
}
