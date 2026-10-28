/**
 * #1569: a ₹0 health probe for every configured AI key. Each call reads a provider's free models (or key)
 * endpoint: no generation, no spend. Only the env name and index leave this module, never the key.
 * A key is `dead` when the provider refuses it (401/402/403, or Gemini's 400 API_KEY_INVALID): that pages DevOps.
 * Anything else (timeouts, 5xx, 429) is reported but doesn't alert.
 */
export type KeyHealth = { name: string; provider: string; status: "ok" | "dead" | "unknown"; detail: string };

type Probe = { provider: string; url: string; headers: Record<string, string> };
type Env = {
  GROQ_API_KEYS: string[]; OPENROUTER_API_KEYS: string[]; GOOGLE_AI_API_KEYS: string[]; CEREBRAS_API_KEYS: string[];
  CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_AI_TOKEN: string; FALAI_API_KEY: string; OPENAI_API_KEY: string;
};

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export function keyProbes(env: Env): { name: string; probe: Probe }[] {
  const list = (envName: string, keys: string[], probe: (key: string) => Probe) =>
    keys.filter(Boolean).map((key, index) => ({ name: `${envName}[${index}]`, probe: probe(key) }));
  const one = (envName: string, key: string, probe: (key: string) => Probe) => key ? [{ name: envName, probe: probe(key) }] : [];
  return [
    ...list("GROQ_API_KEYS", env.GROQ_API_KEYS, (key) => ({ provider: "groq", url: "https://api.groq.com/openai/v1/models", headers: bearer(key) })),
    ...list("OPENROUTER_API_KEYS", env.OPENROUTER_API_KEYS, (key) => ({ provider: "openrouter", url: "https://openrouter.ai/api/v1/key", headers: bearer(key) })),
    ...list("GOOGLE_AI_API_KEYS", env.GOOGLE_AI_API_KEYS, (key) => ({ provider: "google", url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: { "x-goog-api-key": key } })),
    ...list("CEREBRAS_API_KEYS", env.CEREBRAS_API_KEYS, (key) => ({ provider: "cerebras", url: "https://api.cerebras.ai/v1/models", headers: bearer(key) })),
    ...(env.CLOUDFLARE_ACCOUNT_ID ? one("CLOUDFLARE_AI_TOKEN", env.CLOUDFLARE_AI_TOKEN, (key) => ({ provider: "cloudflare",
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/models/search?per_page=1`, headers: bearer(key) })) : []),
    ...one("FALAI_API_KEY", env.FALAI_API_KEY, (key) => ({ provider: "fal", url: "https://api.fal.ai/v1/models?limit=1", headers: { Authorization: `Key ${key}` } })),
    ...one("OPENAI_API_KEY", env.OPENAI_API_KEY, (key) => ({ provider: "openai", url: "https://api.openai.com/v1/models", headers: bearer(key) })),
  ];
}

/** What a probe's answer means; `body` only matters for Gemini's 400. */
export function classifyKey(provider: string, status: number, body: string): Pick<KeyHealth, "status" | "detail"> {
  if (status >= 200 && status < 300) return { status: "ok", detail: `HTTP_${status}` };
  if (status === 401 || status === 402 || status === 403) return { status: "dead", detail: `HTTP_${status}` };
  if (provider === "google" && status === 400 && body.includes("API_KEY_INVALID")) return { status: "dead", detail: "HTTP_400_API_KEY_INVALID" };
  return { status: "unknown", detail: `HTTP_${status}` };
}

export async function probeKeys(env: Env, fetcher: typeof fetch = fetch): Promise<KeyHealth[]> {
  return Promise.all(keyProbes(env).map(async ({ name, probe }) => {
    try {
      const res = await fetcher(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const body = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 2_000);
      return { name, provider: probe.provider, ...classifyKey(probe.provider, res.status, body) };
    } catch {
      return { name, provider: probe.provider, status: "unknown" as const, detail: "UNREACHABLE" };
    }
  }));
}
