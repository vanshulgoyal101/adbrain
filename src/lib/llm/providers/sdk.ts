import { APICallError, generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { LLMError, type ChatMessage, type CompletionOptions, type ProviderCompletion } from "../types";

function providerId(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.:-]{1,256}$/.test(value) ? value : undefined;
}

export async function sdkCompletion(
  provider: string,
  model: LanguageModel,
  messages: ChatMessage[],
  options: CompletionOptions,
  maxOutputTokens = options.maxTokens,
): Promise<ProviderCompletion> {
  options.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(options.attemptTimeoutMs ?? 90_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const output = options.responseSchema ? Output.object({ schema: options.responseSchema }) : Output.text();
  if ((options.json || options.responseSchema) && !(provider === "google" && options.responseSchema)) {
    output.responseFormat = Promise.resolve({ type: "json" });
  }
  try {
    const result = await generateText({
      model,
      messages,
      allowSystemInMessages: true,
      temperature: options.temperature ?? 0.7,
      maxOutputTokens,
      maxRetries: 0,
      include: { responseBody: true },
      abortSignal: signal,
      output,
    }).catch((error: unknown) => {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      return {
        text: error.text ?? "",
        finishReason: error.finishReason ?? "unknown",
        response: error.response,
      };
    });
    signal.throwIfAborted();
    const body = (result.response as { body?: unknown } | undefined)?.body as {
      id?: string;
      responseId?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    } | undefined;
    const providerRequestId = providerId(provider === "google" ? body?.responseId : body?.id);
    const reported = provider === "google" ? body?.usageMetadata : body?.usage;
    const promptTokens = provider === "google" ? body?.usageMetadata?.promptTokenCount : body?.usage?.prompt_tokens;
    const completionTokens = provider === "google" ? body?.usageMetadata?.candidatesTokenCount : body?.usage?.completion_tokens;
    const totalTokens = provider === "google" ? body?.usageMetadata?.totalTokenCount : body?.usage?.total_tokens;
    const usage = reported ? {
      promptTokens: promptTokens ?? 0,
      completionTokens: completionTokens ?? 0,
      totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
    } : undefined;
    if (result.finishReason === "length") {
      const guidance = options.routing === "budget"
        ? "The budget-model output was truncated; retry the task or shorten its input."
        : "Increase the task token budget or reduce reasoning effort.";
      throw new LLMError(`${provider}: ${options.task ?? "LLM task"} output token budget exhausted before completion. ${guidance}`, {
        provider, retryable: false, model: typeof model === "string" ? model : model.modelId, usage,
        providerRequestId, providerFinalStatus: "completed", code: "TRUNCATED",
      });
    }
    if (!result.text) {
      throw new LLMError(`${provider}: empty response (finish reason: ${result.finishReason})`, {
        provider, retryable: true, providerRequestId, providerFinalStatus: "completed", code: "EMPTY",
      });
    }
    return { text: result.text, usage, providerRequestId, providerFinalStatus: "completed" };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (deadline.aborted) {
      throw new LLMError(`${provider}: request deadline exceeded`, { provider, retryable: false, code: "TIMEOUT" });
    }
    if (error instanceof LLMError) throw error;
    if (APICallError.isInstance(error)) {
      const status = error.statusCode;
      const headers = error.responseHeaders;
      throw new LLMError(`${provider}: ${status ? `HTTP ${status}` : "provider request failed"}`, {
        provider, status, providerFinalStatus: "unknown", code: status ? `HTTP_${status}` : "TRANSPORT",
        providerRequestId: providerId(headers?.["x-request-id"] ?? headers?.["x-openrouter-request-id"] ?? headers?.["x-goog-request-id"]),
        retryable: status === undefined || status === 429 || status >= 500 || status === 403 || (provider !== "google" && status === 401),
      });
    }
    throw new LLMError(`${provider}: network or provider response error`, { provider, retryable: true, code: "TRANSPORT" });
  }
}