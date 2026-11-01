import { getEnv } from "@/lib/env";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAICompatibleProvider } from "./providers/openai-compatible";
import { cacheKey, withCache } from "./cache";
import { recordUsage } from "./usage";
import { FREE_TEXT_PROVIDERS, freeTextOnly } from "./spend-policy";
import {
  AllLLMProvidersFailedError,
  LLMError,
  NoLLMKeysError,
  type ChatMessage,
  type CompletionOptions,
  type CompletionResult,
  type LLMFailureCode,
  type LLMProvider,
  type ProviderFailureReason,
} from "./types";

export type {
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  LLMFailureCode,
  TokenUsage,
} from "./types";
export { AllLLMProvidersFailedError, LLMError, NoLLMKeysError } from "./types";
export { clearLLMCache, llmCacheSize } from "./cache";
export { usageSnapshot, resetUsage, type UsageTotals } from "./usage";

interface RegisteredProvider {
  provider: LLMProvider;
  keys: string[];
  model: string;
}

// Keys that hit a 429 are parked for a cooldown so we stop hammering them.
const COOLDOWN_MS = 60_000;
// Groq keys share one organization tokens-per-minute limit; a few seconds' wait
// beats falling through to a model that needs 60-90s.
const RATE_LIMIT_WAIT_MS = 20_000;
const cooldownUntil = new Map<string, number>();
// #1568: a provider that hit a named rate limit in this process is probed by one call at a time after its park;
// calls made while that probe is out go to the next provider instead of piling onto a limit that may still hold
// (with no next provider and `waitOnLastProvider`, they wait for the probe: #2189).
const rateLimited = new Set<string>();
const probing = new Map<string, Promise<void>>();
// #2189: with `waitOnLastProvider`, the last provider left waits out a limit it named (Groq's OTPM: ≤ COOLDOWN_MS a
// round), for at most this many rounds and this much sleep per call. A bare 429 keeps the short wait.
const LAST_RESORT_ROUNDS = 6;
const LAST_RESORT_WAIT_BUDGET_MS = 90_000;
// Until when a named limit parks each provider; unlike `rateLimited`, another call's success doesn't clear it.
const namedParkUntil = new Map<string, number>();
/** #1808: the Cerebras model, exported so the scheduled model check reads the same id. */
export const CEREBRAS_MODEL = "llama-3.3-70b";
// #449: a key out of credit stays parked long enough not to slow every Create; the free models answer meanwhile.
const CREDIT_COOLDOWN_MS = 15 * 60_000;
// #1568: a daily limit parks the provider until its own retry-after, up to this long.
const DAILY_PARK_MAX_MS = 6 * 3_600_000;
// Round-robin cursor per provider so load spreads across a key pool.
const rrCursor = new Map<string, number>();

function buildRegistry(routing: "standard" | "budget" | "creative" = "standard", extraProviders: string[] = [], nextProviders: string[] = []): RegisteredProvider[] {
  const env = getEnv();

  const registry: Record<string, RegisteredProvider[] | RegisteredProvider | null> = {
    google: env.GOOGLE_AI_API_KEYS.length
      ? {
          provider: createGeminiProvider({
            thinkingHeadroom: env.GEMINI_THINKING_HEADROOM,
          }),
          keys: env.GOOGLE_AI_API_KEYS,
          model: env.GEMINI_MODEL,
        }
      : null,
    groq: env.GROQ_API_KEYS.length
      ? {
          provider: createOpenAICompatibleProvider({
            name: "groq",
            baseUrl: "https://api.groq.com/openai/v1/chat/completions",
            defaultModel: env.GROQ_MODEL,
          }),
          keys: env.GROQ_API_KEYS,
          model: env.GROQ_MODEL,
        }
      : null,
    openrouter: env.OPENROUTER_API_KEYS.length
      ? env.OPENROUTER_MODEL.split(",").map((s) => s.trim()).filter(Boolean).map((model) => ({
          provider: createOpenAICompatibleProvider({
            name: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1/chat/completions",
            defaultModel: model,
            extraHeaders: {
              "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL,
              "X-Title": "AdBrain",
            },
          }),
          keys: env.OPENROUTER_API_KEYS,
          model,
        }))
      : null,
    cerebras: env.CEREBRAS_API_KEYS.length
      ? {
          provider: createOpenAICompatibleProvider({
            name: "cerebras",
            baseUrl: "https://api.cerebras.ai/v1/chat/completions",
            defaultModel: CEREBRAS_MODEL,
          }),
          keys: env.CEREBRAS_API_KEYS,
          model: CEREBRAS_MODEL,
        }
      : null,
  };

  const orderValue = routing === "budget"
    ? env.LLM_BUDGET_PROVIDER_ORDER
    : routing === "creative" ? env.CREATIVE_PROVIDER_ORDER || env.LLM_PROVIDER_ORDER
      : env.LLM_PROVIDER_ORDER;
  const configured = orderValue.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const listed = [...configured, ...extraProviders.filter((name) => !configured.includes(name))];
  const next = nextProviders.filter((name) => name !== listed[0]);
  const order = listed.length ? [listed[0], ...next, ...listed.slice(1).filter((name) => !next.includes(name))] : next;

  return order
    .flatMap((name) => registry[name] ?? []);
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
  // #2230: the smoke login never pays for text; when the free models can't answer, it fails with a clear reason.
  const freeOnly = freeTextOnly();
  const registry = buildRegistry(options.routing, options.extraProviders, options.nextProviders)
    .filter(({ provider }) => !freeOnly || FREE_TEXT_PROVIDERS.includes(provider.name));
  if (registry.length === 0) throw freeOnly ? new AllLLMProvidersFailedError("FREE_TEXT_UNAVAILABLE", 0) : new NoLLMKeysError();

  const startedAt = Date.now();
  const result = await withCache(
    cacheKey(messages, options),
    options.cache,
    () => callProviders(messages, options, registry, freeOnly ? [] : buildRegistry("standard")
      .filter(({ provider }) => FREE_TEXT_PROVIDERS.includes(provider.name) && !registry.some((entry) => entry.provider.name === provider.name)))
      .catch((error: unknown) => {
        throw freeOnly && error instanceof AllLLMProvidersFailedError ? new AllLLMProvidersFailedError("FREE_TEXT_UNAVAILABLE", registry.length) : error;
      }),
  );
  const enriched = {
    ...result,
    latencyMs: Date.now() - startedAt,
    inputChars: messages.reduce((sum, message) => sum + message.content.length, 0),
    outputChars: result.text.length,
  };
  recordUsage(enriched);
  return enriched;
}

/** Rotate across providers/keys, returning the first success. */
async function callProviders(
  messages: ChatMessage[],
  options: CompletionOptions,
  registry: RegisteredProvider[],
  /** Free models tried only after a key ran out of credit (#449). */
  creditFallback: RegisteredProvider[] = [],
): Promise<CompletionResult> {
  const failures: ProviderFailureReason[] = [];
  let terminal: LLMError | undefined;
  let creditExhausted = false;

  const queue = [...registry];
  const deferred = new Set<RegisteredProvider>();
  const available = ({ provider, keys }: RegisteredProvider) =>
    keys.some((_, idx) => (cooldownUntil.get(`${provider.name}:${idx}`) ?? 0) <= Date.now());
  // #2462: hold the reserve for any later provider that is usable by the time it would be handed the call.
  const reserve = options.fallbackReserve;
  const usableAtHandoff = ({ provider, keys }: RegisteredProvider) => !reserve ||
    keys.some((_, idx) => (cooldownUntil.get(`${provider.name}:${idx}`) ?? 0) <= reserve.deadlineAt - reserve.reserveMs);
  const reservedMs = (position: number) => !reserve ? Infinity
    : reserve.deadlineAt - Date.now() - (queue.slice(position + 1).some(usableAtHandoff) ? reserve.reserveMs : 0);
  for (let position = 0; position < queue.length; position++) {
    const entry = queue[position];
    const { provider, keys, model } = entry;
    // #2189: with nothing after this provider, giving up loses the call; the caller's deadline bounds the wait instead.
    const lastResort = () => Boolean(options.waitOnLastProvider && options.signal) && !queue.slice(position + 1).some(available);
    let slept = 0;
    let outOfTime = false;
    for (let round = 0; !outOfTime; round++) {
      const start = nextKeyStart(provider.name, keys.length);
      for (let i = 0; i < keys.length; i++) {
        options.signal?.throwIfAborted();
        const idx = (start + i) % keys.length;
        const coolKey = `${provider.name}:${idx}`;
        if ((cooldownUntil.get(coolKey) ?? 0) > Date.now()) continue;
        const capMs = options.providerAttemptTimeoutMs?.[provider.name] ?? options.attemptTimeoutMs;
        const attemptTimeoutMs = reserve ? Math.min(capMs ?? Infinity, reservedMs(position)) : capMs;
        if (attemptTimeoutMs !== undefined && attemptTimeoutMs <= 0) {
          outOfTime = true;
          failures.push("TIMEOUT");
          break;
        }
        const inFlightProbe = rateLimited.has(provider.name) ? probing.get(provider.name) : undefined;
        if (inFlightProbe) {
          if (!lastResort()) break;
          await abortable(inFlightProbe, options.signal);
          i--;
          continue;
        }
        const probe = rateLimited.has(provider.name);
        let settleProbe = () => {};
        if (probe) probing.set(provider.name, new Promise<void>((resolve) => { settleProbe = resolve; }));
        const endProbe = () => { probing.delete(provider.name); settleProbe(); };

        const attemptStart = Date.now();
        try {
          const maxTokens = options.providerMaxTokens?.[provider.name] ?? options.maxTokens;
          const { text, usage, providerRequestId, providerFinalStatus } = await provider.complete(messages, { ...options, attemptTimeoutMs, maxTokens }, {
            apiKey: keys[idx],
            model,
          });
          options.onAttempt?.({ provider: provider.name, model, usage, providerRequestId,
            providerFinalStatus: providerFinalStatus ?? "unknown", status: "success", latencyMs: Date.now() - attemptStart });
          rateLimited.delete(provider.name);
          return { text, provider: provider.name, model, usage, providerRequestId, providerFinalStatus };
        } catch (err) {
          const failure: LLMFailureCode = options.signal?.aborted
            ? (options.signal.reason as { name?: string } | undefined)?.name === "TimeoutError" ? "DEADLINE" : "ABORTED"
            : err instanceof LLMError ? err.code ?? "UNKNOWN" : "UNKNOWN";
          options.onAttempt?.({ provider: provider.name, model,
            usage: err instanceof LLMError ? err.usage : undefined,
            providerRequestId: err instanceof LLMError ? err.providerRequestId : undefined,
            providerFinalStatus: err instanceof LLMError ? err.providerFinalStatus ?? "unknown" : "unknown",
            status: "error", failure, latencyMs: Date.now() - attemptStart,
            ...(err instanceof LLMError && err.rateLimit ? { rateLimit: err.rateLimit } : {}) });
          if (err instanceof LLMError && err.usage) {
            recordUsage({ text: "", provider: provider.name, model, usage: err.usage });
          }
          options.signal?.throwIfAborted();
          if (failure === "CREDIT_EXHAUSTED") {
            creditExhausted = true;
            cooldownUntil.set(coolKey, Date.now() + CREDIT_COOLDOWN_MS);
            failures.push("CREDIT_EXHAUSTED");
            continue;
          }
          failures.push(failure === "TIMEOUT" ? "TIMEOUT" : failure === "TRUNCATED" ? "TRUNCATED"
            : err instanceof LLMError ? err.status === 429 ? "RATE_LIMIT"
              : err.status && err.status >= 500 ? "PROVIDER_SERVER"
                : err.status ? "PROVIDER_CLIENT" : "TRANSPORT" : "UNKNOWN");
          if (err instanceof LLMError && err.status === 429) {
            // #1200/#1568: a daily limit doesn't lift in a minute; park until the provider's retry-after (≤ 6 h).
            const daily = err.rateLimit?.type === "TPD" || err.rateLimit?.type === "RPD";
            const until = Date.now() + Math.min(err.retryAfterMs ?? (daily ? CREDIT_COOLDOWN_MS : COOLDOWN_MS), daily ? DAILY_PARK_MAX_MS : COOLDOWN_MS);
            // #1568: a limit the provider names (Groq's TPD, OTPM…) is the organization's, shared by every key.
            const parked = err.rateLimit ? keys.map((_, k) => `${provider.name}:${k}`) : [coolKey];
            for (const key of parked) cooldownUntil.set(key, Math.max(cooldownUntil.get(key) ?? 0, until));
            if (err.rateLimit) {
              rateLimited.add(provider.name);
              namedParkUntil.set(provider.name, Math.max(namedParkUntil.get(provider.name) ?? 0, until));
            }
          }
          // Another key on the same model would time out or truncate the same way; try the next model.
          if (err instanceof LLMError && !err.retryable && err.status === undefined) {
            terminal = err;
            break;
          }
          // A 5xx means the model is overloaded or down for every key.
          if (err instanceof LLMError && err.status !== undefined && err.status >= 500) break;
        } finally {
          // After the outcome is recorded, so a waiting call sees Groq answered or parked again.
          if (probe) endProbe();
        }
      }
      if (outOfTime) break;
      // Every key is rate-limited only briefly: wait once, then retry this model.
      const wait = Math.min(...keys.map((_, idx) => cooldownUntil.get(`${provider.name}:${idx}`) ?? 0)) - Date.now();
      const last = lastResort() && (namedParkUntil.get(provider.name) ?? 0) > Date.now() && slept + wait <= LAST_RESORT_WAIT_BUDGET_MS;
      if (round + 1 >= (last ? LAST_RESORT_ROUNDS : 2) || wait <= 0 || wait > (last ? COOLDOWN_MS : RATE_LIMIT_WAIT_MS)) break;
      if (wait >= reservedMs(position)) break;
      // #668: a fast fallback answers sooner than the cooldown ends; come back to this provider after it.
      if (options.fallbackBeforeRateLimitWait && !deferred.has(entry) && queue.slice(position + 1).some(available)) {
        deferred.add(entry);
        queue.push(entry);
        break;
      }
      await sleep(wait, options.signal);
      slept += wait;
    }
  }

  // Out of credit (or parked for it): answer with a free model rather than fail (#449).
  const parked = registry.some(({ provider, keys }) => provider.name === "openrouter"
    && keys.every((_, idx) => (cooldownUntil.get(`${provider.name}:${idx}`) ?? 0) > Date.now()));
  if ((creditExhausted || parked) && creditFallback.length) return callProviders(messages, options, creditFallback);
  if (terminal && failures.length === 1) throw terminal;
  throw new AllLLMProvidersFailedError(failures.length === 0 ? "COOLDOWN"
    : failures.every((reason) => reason === failures[0]) ? failures[0] : "MIXED", registry.length);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }), signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Await `waitFor`, rejecting with the signal's reason as soon as it aborts. */
async function abortable(waitFor: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) return waitFor;
  let onAbort = () => {};
  try {
    await Promise.race([waitFor, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    })]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Run a completion in JSON mode and parse the result. */
export async function completeJSON<T>(
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<T> {
  const result = await complete(messages, { ...options, json: true });
  let parsed: T;
  try {
    const value = parseJSON<T>(result.text);
    parsed = options.responseSchema ? options.responseSchema.parse(value) as T : value;
  } catch (error) {
    if (!options.responseSchema) throw error;
    throw new LLMError("LLM JSON output did not match the task schema", {
      provider: result.provider, retryable: false,
    });
  }
  if (parsed && typeof parsed === "object") {
    Object.defineProperty(parsed, "__completion", {
      value: result,
      enumerable: false,
      configurable: true,
    });
  }
  return parsed;
}

/** Robustly parse JSON that may be wrapped in prose or ```json fences. */
export function parseJSON<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/[[{][\s\S]*[\]}]/)?.[0];
  for (const candidate of [cleaned, escapeRawControls(cleaned), ...(match ? [match, escapeRawControls(match)] : [])]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next repair
    }
  }
  throw new Error(`Failed to parse LLM JSON output: ${text.slice(0, 200)}`);
}

/**
 * #2444: Gemini flash-lite writes the line breaks of a multi-line field as raw newlines inside the JSON string
 * ("Bad control character in string literal"); 3 of 6 recorded concepts. Escape control characters inside strings
 * only; whitespace between tokens is valid JSON and stays.
 */
function escapeRawControls(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of json) {
    if (inString && !escaped && char < " ") {
      out += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    if (char === '"' && !escaped) inString = !inString;
    escaped = inString && !escaped && char === "\\";
    out += char;
  }
  return out;
}
