import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import type { LLMProvider } from "../types";
import { sdkCompletion } from "./sdk";

/**
 * Build a provider that speaks the OpenAI Chat Completions API shape.
 * Works for Groq, OpenRouter, Cerebras, Together, and OpenAI itself.
 */
export function createOpenAICompatibleProvider(config: {
  name: string;
  baseUrl: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}): LLMProvider {
  return {
    name: config.name,
    defaultModel: config.defaultModel,
    async complete(messages, options, ctx) {
      const model = new OpenAICompatibleChatLanguageModel(ctx.model, {
        provider: `${config.name}.chat`,
        url: () => config.baseUrl,
        headers: () => ({ Authorization: `Bearer ${ctx.apiKey}`, ...config.extraHeaders }),
        transformRequestBody: (body) => ({
          ...body,
          ...(config.name === "openrouter" && options.reasoningEffort
            ? { reasoning: { effort: options.reasoningEffort, exclude: true } }
            : {}),
        }),
      });
      return sdkCompletion(config.name, model, messages, options);
    },
  };
}
