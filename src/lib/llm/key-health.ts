/**
 * #1569: a ₹0 health probe for every configured AI key. Each call reads a provider's free models (or key)
 * endpoint: no generation, no spend. Only the env name and index leave this module, never the key.
 * A key is `dead` when the provider refuses it (401/402/403, or Gemini's 400 API_KEY_INVALID): that pages DevOps.
 * Anything else (timeouts, 5xx, 429) is reported but doesn't alert.
 */
import { CLOUDFLARE_IMAGE_MODEL } from "@/lib/imageGen/providers/cloudflare";
import { CEREBRAS_MODEL } from "@/lib/llm";

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

/**
 * #1808: every configured model id must still be on its provider's /models list; a retired id fails Create the same
 * way a dead key does. One list read per provider (free, no generation). `missing` pages DevOps; a list that can't be
 * read is `unknown` and never alerts. Ids only, never keys.
 */
export type ModelHealth = { provider: string; model: string; status: "listed" | "missing" | "unknown"; detail: string };
type ModelEnv = Env & { GEMINI_MODEL: string; GROQ_MODEL: string; OPENROUTER_MODEL: string; OPENROUTER_IMAGE_MODEL: string };
type ModelList = { url: string; headers: Record<string, string>; ids: (body: unknown) => string[]; id?: (model: string) => string };

export function configuredModels(env: ModelEnv): { provider: string; model: string }[] {
  const has = (keys: string[]) => keys.some(Boolean);
  return [
    ...(has(env.GROQ_API_KEYS) && env.GROQ_MODEL ? [{ provider: "groq", model: env.GROQ_MODEL }] : []),
    ...(has(env.OPENROUTER_API_KEYS) ? [...env.OPENROUTER_MODEL.split(","), env.OPENROUTER_IMAGE_MODEL]
      .map((model) => model.trim()).filter(Boolean).map((model) => ({ provider: "openrouter", model })) : []),
    ...(has(env.GOOGLE_AI_API_KEYS) && env.GEMINI_MODEL ? [{ provider: "google", model: env.GEMINI_MODEL }] : []),
    ...(has(env.CEREBRAS_API_KEYS) ? [{ provider: "cerebras", model: CEREBRAS_MODEL }] : []),
    ...(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN ? [{ provider: "cloudflare", model: CLOUDFLARE_IMAGE_MODEL }] : []),
  ];
}

function modelList(provider: string, env: ModelEnv): ModelList | null {
  const first = (keys: string[]) => keys.find(Boolean) ?? "";
  const data = (body: unknown) => ((body as { data?: { id?: string }[] })?.data ?? []).map((item) => String(item.id));
  switch (provider) {
    case "groq": return { url: "https://api.groq.com/openai/v1/models", headers: bearer(first(env.GROQ_API_KEYS)), ids: data };
    // `output_modalities=all`: the default list leaves out image models.
    case "openrouter": return { url: "https://openrouter.ai/api/v1/models?output_modalities=all", headers: bearer(first(env.OPENROUTER_API_KEYS)), ids: data };
    case "google": return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers: { "x-goog-api-key": first(env.GOOGLE_AI_API_KEYS) },
      ids: (body) => ((body as { models?: { name?: string }[] })?.models ?? []).map((item) => String(item.name)), id: (model) => `models/${model}` };
    case "cerebras": return { url: "https://api.cerebras.ai/v1/models", headers: bearer(first(env.CEREBRAS_API_KEYS)), ids: data };
    case "cloudflare": return { url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/models/search?per_page=1000`,
      headers: bearer(env.CLOUDFLARE_AI_TOKEN), ids: (body) => ((body as { result?: { name?: string }[] })?.result ?? []).map((item) => String(item.name)) };
    default: return null;
  }
}

export async function checkModels(env: ModelEnv, fetcher: typeof fetch = fetch): Promise<ModelHealth[]> {
  const wanted = configuredModels(env);
  const lists = new Map<string, Promise<{ ids: Set<string> } | { detail: string }>>();
  for (const { provider } of wanted) {
    if (lists.has(provider)) continue;
    const list = modelList(provider, env)!;
    lists.set(provider, fetcher(list.url, { headers: list.headers, signal: AbortSignal.timeout(15_000), cache: "no-store" })
      .then(async (res) => res.ok ? { ids: new Set(list.ids(await res.json())) } : { detail: `HTTP_${res.status}` })
      .catch(() => ({ detail: "UNREACHABLE" })));
  }
  return Promise.all(wanted.map(async ({ provider, model }) => {
    const list = await lists.get(provider)!;
    if (!("ids" in list) || !list.ids.size) return { provider, model, status: "unknown" as const, detail: "detail" in list ? list.detail : "EMPTY_LIST" };
    const id = modelList(provider, env)!.id?.(model) ?? model;
    return { provider, model, status: list.ids.has(id) ? "listed" as const : "missing" as const, detail: list.ids.has(id) ? "LISTED" : "NOT_ON_LIST" };
  }));
}
