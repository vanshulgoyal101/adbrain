import { vi } from "vitest";

/** Shared helpers for the core regression gate (`npm run test:core`). */

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export function requestBody(init?: RequestInit): string {
  return typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
}

/** Resolves after `ms` (virtual when fake timers are on) or rejects when the request is aborted. */
export function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** An OpenAI-compatible chat completion body (OpenRouter, Groq). */
export function openAIReply(text: string, model: string, usage = { prompt: 2_470, completion: 3_000 }) {
  return Response.json({
    id: "gen-core-replay",
    object: "chat.completion",
    created: 1_792_596_928,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion },
  });
}

/** A Gemini generateContent body. */
export function googleReply(text: string, usage = { prompt: 2_470, completion: 3_000 }) {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: usage.prompt, candidatesTokenCount: usage.completion, totalTokenCount: usage.prompt + usage.completion },
    responseId: "core-replay",
  });
}

/**
 * Runs provider latencies and route deadlines on a virtual clock. Vitest fake
 * timers do not drive `AbortSignal.timeout`, so it is rebuilt on fake
 * `setTimeout`. `llmAttemptDeadlines` records the per-attempt LLM deadline the
 * code under test actually requested.
 */
export function useVirtualDeadlines() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const llmAttemptDeadlines: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 30;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    if (stack.includes("llm/providers/sdk")) llmAttemptDeadlines.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
    return controller.signal;
  });
  return { llmAttemptDeadlines, startedAt: Date.now() };
}

/**
 * Advances the virtual clock timer by timer until `promise` settles. Import the
 * code under test before starting the clock: module loading is real IO.
 */
export async function settleInVirtualTime<T>(promise: Promise<T>, limitMs = 600_000): Promise<T> {
  const startedAt = Date.now();
  let settled = false;
  let idleRounds = 0;
  promise.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) {
    for (let i = 0; i < 5 && !settled; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    if (settled) break;
    if (!vi.getTimerCount()) {
      if (++idleRounds > 200) throw new Error("Core replay stalled with no pending timers.");
      continue;
    }
    idleRounds = 0;
    await vi.advanceTimersToNextTimerAsync();
    if (Date.now() - startedAt > limitMs) throw new Error(`Core replay exceeded ${limitMs} ms of virtual time.`);
  }
  return promise;
}
