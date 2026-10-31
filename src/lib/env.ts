import { z } from "zod";

/** Split a comma-separated env value into a trimmed, non-empty list. */
const commaList = z
  .string()
  .optional()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),

  // App
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  // #796: the owner's business WhatsApp for in-app help (public number; empty hides the link).
  SUPPORT_WHATSAPP: z.string().optional().default(""),
  // #701: AdBrain's own WhatsApp number that sends owner alerts and receives START/STOP (empty hides alerts).
  ALERTS_WHATSAPP: z.string().optional().default(""),
  // #701: the token Meta echoes when subscribing the alerts webhook (hub.verify_token).
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),

  // Dev-only auth bypass (NEVER enable in production)
  NEXT_PUBLIC_DEV_AUTH_BYPASS: z.string().optional().default(""),
  DEV_LOGIN_EMAIL: z.string().optional().default(""),
  DEV_LOGIN_PASSWORD: z.string().optional().default(""),
  DEMO_USER_EMAIL: z.string().email().optional().default("demo@adbrain.vanshul.com"),

  // LLM providers (comma-separated key pools; empty disables the provider)
  GOOGLE_AI_API_KEYS: commaList,
  GROQ_API_KEYS: commaList,
  OPENROUTER_API_KEYS: commaList,
  CEREBRAS_API_KEYS: commaList,
  LLM_PROVIDER_ORDER: z
    .string()
    .optional()
    .default("google,groq,openrouter,cerebras"),
  LLM_BUDGET_PROVIDER_ORDER: z
    .string()
    .optional()
    .default("groq,google,cerebras"),
  // Unset: Create follows LLM_PROVIDER_ORDER (3/3 in Oct 21 run 4); Groq-first lost a draft in run 6.
  CREATIVE_PROVIDER_ORDER: z.string().optional(),
  GEMINI_MODEL: z.string().optional().default("gemini-3.6-flash"),
  // Groq retires models with little notice (llama-3.3-70b-versatile now 404s),
  // so the model is configurable rather than hardcoded.
  GROQ_MODEL: z.string().optional().default("qwen/qwen3.8-27b"),
  // #98 bake-off: 13-15 s per Create concept and 6/6 saved, vs 65-90 s on qwen3.8-max.
  OPENROUTER_MODEL: z.string().optional().default("anthropic/claude-haiku-5.5"),
  CREATIVE_MAX_TOKENS: z.coerce.number().int().min(1800).max(16000).default(6000),
  CREATIVE_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
  // Three chained concept attempts plus the last image must fit Create's 270 s deadline.
  CREATIVE_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().min(15_000).max(120_000).default(90_000),
  CREATIVE_CONCEPT_SCHEDULE: z.enum(["serial", "parallel"]).default("serial"),
  // Output-token headroom for Gemini "thinking" models. Set to 0 for a paid
  // non-thinking model to avoid paying for unused output tokens.
  GEMINI_THINKING_HEADROOM: z.coerce.number().int().min(0).optional().default(3000),
  LLM_MONTHLY_TOKEN_LIMIT: z.coerce.number().int().min(0).optional().default(2_000_000),
  // #1717: a business's monthly AI spend (text and paid pictures, USD) above which its pictures are free; unset = no cap.
  AI_MONTHLY_COST_LIMIT_USD: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().positive().max(10_000).optional()),

  // Image generation
  IMAGE_PROVIDER: z.string().optional().default("pollinations"),
  IMAGE_PROVIDER_FALLBACK: z.string().optional().default("none"),
  POLLINATIONS_MODEL: z.string().optional().default("flux"),
  // #1476: Cloudflare Workers AI FLUX-1-schnell, the free picture; skipped unless both are set.
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().default(""),
  CLOUDFLARE_AI_TOKEN: z.string().optional().default(""),
  OPENROUTER_IMAGE_MODEL: z.string().optional().default("openai/gpt-image-2.5-flare"),
  FALAI_API_KEY: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),
  // Composite the designed poster (logo + headline + benefits + CTA) over the
  // AI photo. Set to "false" to fall back to the bare photo.
  AD_DESIGN_OVERLAY: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),

  // Meta Marketing API (Phase 1)
  META_APP_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_LOGIN_CONFIG_ID: z.string().optional().default(""),
  // Base64-encoded 32-byte key for server-only Meta token encryption.
  META_TOKEN_ENCRYPTION_KEY: z.string().optional().default(""),
  // 2-Tier managed accounts (#518, #520): Solaride is the parent business; its system user's
  // token provisions child businesses. Off until provisioning ships; the token is Sensitive in Vercel.
  MANAGED_ACCOUNTS_ENABLED: z.string().optional().default("false").transform((v) => v === "true" || v === "1"),
  META_PARENT_BUSINESS_ID: z.string().regex(/^\d+$/).optional().default("1158100643072508"),
  META_PARENT_SYSTEM_TOKEN: z.string().optional().default(""),

  // Internal traffic runner (for Meta review call-volume generation)
  TRAFFIC_GENERATOR_MAX_ROUNDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20),
  // Who may run it. Empty in production disables the endpoint entirely.
  TRAFFIC_GENERATOR_ALLOWED_EMAILS: commaList,

  // Shared secret Vercel Cron sends as `Authorization: Bearer <secret>`.
  // Empty disables the cron endpoints (they 404).
  CRON_SECRET: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Lazily validate and memoize server environment variables. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    throw new Error(
      "Invalid or missing environment variables. Copy .env.example to .env.local and fill it in.",
    );
  }
  cached = parsed.data;
  return cached;
}
