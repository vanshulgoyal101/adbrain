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

  // Image generation
  IMAGE_PROVIDER: z.string().optional().default("pollinations"),
  POLLINATIONS_MODEL: z.string().optional().default("flux"),
  FALAI_API_KEY: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),

  // Meta Marketing API (Phase 1)
  META_APP_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_SYSTEM_USER_TOKEN: z.string().optional().default(""),
  META_AD_ACCOUNT_ID: z.string().optional().default(""),
  META_PAGE_ID: z.string().optional().default(""),
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
