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

  // Dev-only auth bypass (NEVER enable in production)
  NEXT_PUBLIC_DEV_AUTH_BYPASS: z.string().optional().default(""),
  DEV_LOGIN_EMAIL: z.string().optional().default(""),
  DEV_LOGIN_PASSWORD: z.string().optional().default(""),

  // LLM providers (comma-separated key pools; empty disables the provider)
  GOOGLE_AI_API_KEYS: commaList,
  GROQ_API_KEYS: commaList,
  OPENROUTER_API_KEYS: commaList,
  CEREBRAS_API_KEYS: commaList,
  LLM_PROVIDER_ORDER: z
    .string()
    .optional()
    .default("google,groq,openrouter,cerebras"),
  GEMINI_MODEL: z.string().optional().default("gemini-2.0-flash"),
  // Output-token headroom for Gemini 2.5 "thinking" models. Set to 0 for a paid
  // non-thinking model to avoid paying for unused output tokens.
  GEMINI_THINKING_HEADROOM: z.coerce.number().int().min(0).optional().default(3000),

  // Image generation
  IMAGE_PROVIDER: z.string().optional().default("pollinations"),
  POLLINATIONS_MODEL: z.string().optional().default("flux"),
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
  META_SYSTEM_USER_TOKEN: z.string().optional().default(""),
  META_AD_ACCOUNT_ID: z.string().optional().default(""),
  META_PAGE_ID: z.string().optional().default(""),

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
