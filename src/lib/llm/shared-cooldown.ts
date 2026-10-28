import { createAdminClient } from "@/lib/supabase/admin";

/**
 * #1568: provider keys parked after a 429 or a credit refusal, shared by every server instance (`llm_cooldowns`), so a
 * fresh serverless instance skips a limited model instead of hitting it again. Fails open: without the store (no
 * service key, a slow or failed read) each instance keeps its own cooldown, as before.
 */
const READ_EVERY_MS = 5_000;
const READ_TIMEOUT_MS = 300;
let cached: { at: number; parks: Map<string, number> } | null = null;
let reading: Promise<Map<string, number>> | null = null;

async function readParks(): Promise<Map<string, number>> {
  try {
    const query = createAdminClient().from("llm_cooldowns").select("key,until").gt("until", new Date(Date.now()).toISOString());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
    const result = await Promise.race([Promise.resolve(query), timeout]).finally(() => clearTimeout(timer));
    if (!result || result.error || !Array.isArray(result.data)) return new Map();
    return new Map(result.data.flatMap((row) => {
      const until = Date.parse(row.until);
      return Number.isFinite(until) ? [[row.key, until] as const] : [];
    }));
  } catch {
    return new Map();
  }
}

/** Active shared parks (key → until, ms), read at most every 5 s per instance. */
export async function sharedParks(now = Date.now()): Promise<Map<string, number>> {
  if (cached && now - cached.at < READ_EVERY_MS) return cached.parks;
  reading ??= readParks().finally(() => { reading = null; });
  const parks = await reading;
  cached = { at: Date.now(), parks };
  return parks;
}

/** Parks a key for every instance until `until` (ms). Fire and forget; this instance's own cooldown already applies. */
export function parkShared(key: string, until: number): void {
  cached?.parks.set(key, Math.max(cached.parks.get(key) ?? 0, until));
  try {
    void Promise.resolve(createAdminClient().rpc("park_llm_key", { p_key: key, p_until: new Date(until).toISOString() }))
      .then(() => undefined, () => undefined);
  } catch {
    // No store (tests, local without a service key).
  }
}

export function _resetSharedParks(): void {
  cached = null;
  reading = null;
}
