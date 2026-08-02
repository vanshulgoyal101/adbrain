import { getEnv } from "@/lib/env";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAICompatibleProvider } from "./providers/openai-compatible";
import {
  LLMError,
  NoLLMKeysError,
  type ChatMessage,
  type CompletionOptions,
  type CompletionResult,
  type LLMProvider,
} from "./types";

export type { ChatMessage, CompletionOptions, CompletionResult } from "./types";
export { LLMError, NoLLMKeysError } from "./types";

interface RegisteredProvider {
  provider: LLMProvider;
  keys: string[];
  model: string;
}

// Keys that hit a 429 are parked for a cooldown so we stop hammering them.
const COOLDOWN_MS = 60_000;
const cooldownUntil = new Map<string, number>();
// Round-robin cursor per provider so load spreads across a key pool.
const rrCursor = new Map<string, number>();

function buildRegistry(): RegisteredProvider[] {
  const env = getEnv();

  const registry: Record<string, RegisteredProvider | null> = {
    google: env.GOOGLE_AI_API_KEYS.length
      ? {
          provider: createGeminiProvider(),
          keys: env.GOOGLE_AI_API_KEYS,
          model: "gemini-2.0-flash",
        }
      : null,
    groq: env.GROQ_API_KEYS.length
      ? {
          provider: createOpenAICompatibleProvider({
            name: "groq",
            baseUrl: "https://api.groq.com/openai/v1/chat/completions",
            defaultModel: "llama-3.3-70b-versatile",
          }),
          keys: env.GROQ_API_KEYS,
          model: "llama-3.3-70b-versatile",
        }
      : null,
    openrouter: env.OPENROUTER_API_KEYS.length
      ? {
          provider: createOpenAICompatibleProvider({
            name: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1/chat/completions",
            defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
            extraHeaders: {
              "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL,
              "X-Title": "AdBrain",
            },
          }),
          keys: env.OPENROUTER_API_KEYS,
          model: "meta-llama/llama-3.3-70b-instruct:free",
        }
      : null,
    cerebras: env.CEREBRAS_API_KEYS.length
      ? {
          provider: createOpenAICompatibleProvider({
            name: "cerebras",
            baseUrl: "https://api.cerebras.ai/v1/chat/completions",
            defaultModel: "llama-3.3-70b",
          }),
          keys: env.CEREBRAS_API_KEYS,
          model: "llama-3.3-70b",
        }
      : null,
  };

  const order = env.LLM_PROVIDER_ORDER.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return order
    .map((name) => registry[name])
    .filter((r): r is RegisteredProvider => r != null);
}

function nextKeyStart(providerName: string, keyCount: number): number {
  const cur = rrCursor.get(providerName) ?? 0;
  rrCursor.set(providerName, (cur + 1) % keyCount);
  return cur % keyCount;
}

/**
 * Run a chat completion, rotating across providers (in LLM_PROVIDER_ORDER) and
 * across each provider's key pool. Rate-limited keys are skipped during a
 * cooldown. Throws only if every provider/key combination fails.
 */
export async function complete(
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<CompletionResult> {
  const registry = buildRegistry();
  if (registry.length === 0) throw new NoLLMKeysError();

  const errors: string[] = [];
  const now = Date.now();

  for (const { provider, keys, model } of registry) {
    const start = nextKeyStart(provider.name, keys.length);
    for (let i = 0; i < keys.length; i++) {
      const idx = (start + i) % keys.length;
      const coolKey = `${provider.name}:${idx}`;
      if ((cooldownUntil.get(coolKey) ?? 0) > now) continue;

      try {
        const text = await provider.complete(messages, options, {
          apiKey: keys[idx],
          model,
        });
        return { text, provider: provider.name, model };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}[key ${idx}]: ${message}`);
        if (err instanceof LLMError && err.status === 429) {
          cooldownUntil.set(coolKey, Date.now() + COOLDOWN_MS);
        }
      }
    }
  }

  throw new Error(
    `All LLM providers failed (${registry.length} tried):\n${errors.join("\n")}`,
  );
}

/** Run a completion in JSON mode and parse the result. */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<T> {
  const result = await complete(messages, { ...options, json: true });
  return parseJSON<T>(result.text);
}

/** Robustly parse JSON that may be wrapped in prose or ```json fences. */
export function parseJSON<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error(`Failed to parse LLM JSON output: ${text.slice(0, 200)}`);
  }
}

/** Whether at least one provider has keys — used to gate AI features in the UI. */
export function isLLMConfigured(): boolean {
  return buildRegistry().length > 0;
}

/** Configured providers and their key counts, for diagnostics. */
export function llmProviderStatus(): { name: string; keyCount: number }[] {
  return buildRegistry().map((r) => ({
    name: r.provider.name,
    keyCount: r.keys.length,
  }));
}
