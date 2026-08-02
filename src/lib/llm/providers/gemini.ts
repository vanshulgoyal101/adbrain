import {
  LLMError,
  type ChatMessage,
  type CompletionOptions,
  type LLMProvider,
  type ProviderCallContext,
} from "../types";

/**
 * Google Gemini (Generative Language API). Uses a different request shape than
 * OpenAI: system prompt goes in `systemInstruction`, turns go in `contents`,
 * and the API key is a query param.
 */
export function createGeminiProvider(config?: {
  defaultModel?: string;
}): LLMProvider {
  const defaultModel = config?.defaultModel ?? "gemini-2.0-flash";
  // Gemini 2.5 models spend output tokens on hidden "thinking"; give the
  // requested output budget generous headroom so JSON isn't truncated.
  const THINKING_HEADROOM = 3000;
  return {
    name: "google",
    defaultModel,
    async complete(
      messages: ChatMessage[],
      options: CompletionOptions,
      ctx: ProviderCallContext,
    ): Promise<string> {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");

      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          ...(options.maxTokens
            ? { maxOutputTokens: options.maxTokens + THINKING_HEADROOM }
            : {}),
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${ctx.model}:generateContent?key=${ctx.apiKey}`;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new LLMError(
          `gemini: network error — ${(err as Error).message}`,
          { provider: "google", retryable: true },
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMError(`gemini HTTP ${res.status}: ${text.slice(0, 200)}`, {
          provider: "google",
          status: res.status,
          retryable: res.status === 429 || res.status >= 500 || res.status === 403,
        });
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const content =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("") ?? "";
      if (!content) {
        throw new LLMError("gemini: empty response", {
          provider: "google",
          retryable: true,
        });
      }
      return content;
    },
  };
}
