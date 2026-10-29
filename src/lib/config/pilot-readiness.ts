/**
 * Production settings a paying pilot needs (#1875). Reports names and a short
 * state only; values never leave this module.
 */
type Check = { names: string[]; why: string; on?: (value: string) => boolean; offState?: string };

const CHECKS: Check[] = [
  { names: ["NEXT_PUBLIC_SUPABASE_URL"], why: "database" },
  { names: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"], why: "sign-in" },
  { names: ["SUPABASE_SERVICE_ROLE_KEY"], why: "jobs, tokens and limits" },
  { names: ["NEXT_PUBLIC_SITE_URL"], why: "links and Meta sign-in callback" },
  { names: ["CRON_SECRET"], why: "scheduled sync, alerts and health checks" },
  { names: ["GOOGLE_AI_API_KEYS", "GROQ_API_KEYS", "OPENROUTER_API_KEYS", "CEREBRAS_API_KEYS"], why: "writing ads (any one text AI key pool)" },
  { names: ["OPENROUTER_API_KEYS"], why: "Create's ad-writing model" },
  { names: ["CLOUDFLARE_ACCOUNT_ID"], why: "free ad pictures" },
  { names: ["CLOUDFLARE_AI_TOKEN"], why: "free ad pictures" },
  { names: ["META_APP_ID"], why: "Connect Meta" },
  { names: ["META_APP_SECRET"], why: "Connect Meta and signed Meta calls" },
  { names: ["META_TOKEN_ENCRYPTION_KEY"], why: "storing Meta tokens" },
  { names: ["META_CONNECT_ROLLOUT"], why: "owners can connect Meta", on: (value) => value === "enabled", offState: "not enabled" },
  { names: ["SUPPORT_WHATSAPP"], why: "in-app Help on WhatsApp" },
  { names: ["NEXT_PUBLIC_SUPPORT_WHATSAPP"], why: "homepage WhatsApp link" },
  { names: ["OWNER_ALERTS_ENABLED"], why: "owner WhatsApp alerts", on: (value) => value === "true", offState: "off" },
  { names: ["ALERTS_WHATSAPP"], why: "owner alert number confirmation" },
  { names: ["ALERTS_WHATSAPP_PHONE_ID"], why: "sending owner alerts" },
  { names: ["ALERTS_WHATSAPP_TOKEN"], why: "sending owner alerts" },
  { names: ["WHATSAPP_WEBHOOK_VERIFY_TOKEN"], why: "receiving START replies" },
  { names: ["AD_RESULTS_ENABLED"], why: "results per ad", on: (value) => value === "true", offState: "off" },
];

export type PilotReadinessGap = { name: string; state: "missing" | string; why: string };
export type PilotReadiness = { ok: boolean; missing: PilotReadinessGap[] };

export function pilotReadiness(env: Record<string, string | undefined>): PilotReadiness {
  const missing: PilotReadinessGap[] = [];
  for (const check of CHECKS) {
    const values = check.names.map((name) => env[name]?.trim() ?? "");
    if (!values.some(Boolean)) {
      missing.push({ name: check.names.join(" | "), state: "missing", why: check.why });
    } else if (check.on && !check.on(values[0])) {
      missing.push({ name: check.names[0], state: check.offState ?? "off", why: check.why });
    }
  }
  return { ok: missing.length === 0, missing };
}
