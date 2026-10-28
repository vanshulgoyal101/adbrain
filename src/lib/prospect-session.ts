import { cache } from "react";
import { isProspectAccount } from "@/lib/internal-accounts";
import { createClient } from "@/lib/supabase/server";

/**
 * #1317: whether the signed-in account is a sales prospect's (`+prospect`). Its ads are samples, so pages hide every
 * way to take a clean picture; the export route marks each one instead. Unreadable means no: nothing is hidden.
 */
export const isProspectSession = cache(async function isProspectSession(): Promise<boolean> {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    return isProspectAccount(user);
  } catch {
    return false;
  }
});
