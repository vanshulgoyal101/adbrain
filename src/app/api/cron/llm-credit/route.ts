import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { observeRoute } from "@/lib/observability/logger";

export const runtime = "nodejs";

/** Alert threshold in USD (#449: the CEO asks the owner before Create degrades). */
const LOW_CREDIT_USD = 0.5;

type KeyCredit = { index: number; limitUsd: number | null; remainingUsd: number | null; error?: string };

/**
 * Read-only OpenRouter credit check (#449). Reads `GET /api/v1/key` for each pooled key and returns
 * dollars only, never the key. `low` when any capped key has under LOW_CREDIT_USD left; the scheduled
 * workflow then opens one `decision` issue.
 */
export const GET = observeRoute("/api/cron/llm-credit", "GET", handleGET);

async function handleGET(request: Request) {
  const env = getEnv();
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const keys = await Promise.all(env.OPENROUTER_API_KEYS.map((key, index) => readKey(key, index)));
  const capped = keys.flatMap((k) => (k.remainingUsd === null ? [] : [k.remainingUsd]));
  const minRemainingUsd = capped.length ? Math.min(...capped) : null;
  const ok = keys.every((k) => !k.error);
  return NextResponse.json({
    ok,
    keys,
    minRemainingUsd,
    thresholdUsd: LOW_CREDIT_USD,
    low: minRemainingUsd !== null && minRemainingUsd < LOW_CREDIT_USD,
  }, { status: ok ? 200 : 503 });
}

async function readKey(key: string, index: number): Promise<KeyCredit> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return { index, limitUsd: null, remainingUsd: null, error: `HTTP_${res.status}` };
    const { data } = (await res.json()) as { data?: { limit?: number | null; limit_remaining?: number | null } };
    const limitUsd = typeof data?.limit === "number" ? data.limit : null;
    const remainingUsd = limitUsd !== null && typeof data?.limit_remaining === "number" ? round(data.limit_remaining) : null;
    return { index, limitUsd, remainingUsd };
  } catch {
    return { index, limitUsd: null, remainingUsd: null, error: "UNREACHABLE" };
  }
}

const round = (usd: number) => Math.round(usd * 100) / 100;
