import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LLMProvider } from "../types";
import { sdkCompletion } from "./sdk";

/**
 * Google Gemini (Generative Language API). Uses a different request shape than
 * OpenAI: system prompt goes in `systemInstruction`, turns go in `contents`,
 * and the API key is supplied directly to the SDK provider.
 */
export function createGeminiProvider(config?: {
  defaultModel?: string;
  /**
  * Gemini thinking models spend output tokens on hidden reasoning; add headroom to
   * the requested output budget so JSON isn't truncated. Set to 0 for a paid
   * non-thinking model to stop paying for unused output tokens.
   */
  thinkingHeadroom?: number;
}): LLMProvider {
  const defaultModel = config?.defaultModel ?? "gemini-3.6-flash";
  const THINKING_HEADROOM = config?.thinkingHeadroom ?? 3000;
  return {
    name: "google",
    defaultModel,
    async complete(messages, options, ctx) {
      const provider = createGoogleGenerativeAI({ apiKey: ctx.apiKey });
      const system = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const turns = messages.filter((message) => message.role !== "system");
      return sdkCompletion("google", provider(ctx.model), [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...turns,
      ], options, options.maxTokens ? options.maxTokens + THINKING_HEADROOM : undefined);
    },
  };
}
