import type { ProductEvent } from "@/lib/observability/events";

/**
 * #451 L2: what one Graph call looks like in product_events. The endpoint is a template
 * (`act_[id]/adsets`, `[id]`, `search`): no IDs, no query string, never the token.
 */
export function graphEndpoint(path: string): string {
  return path.split("?")[0].split("/").filter(Boolean).map((segment) =>
    /^act_/.test(segment) ? "act_[id]" : /^[a-z_]{1,40}$/.test(segment) ? segment : "[id]",
  ).join("/") || "[id]";
}

const ENTITY: Record<string, NonNullable<ProductEvent["attributes"]["entityType"]>> = {
  campaigns: "campaign", adsets: "adset", adcreatives: "creative", ads: "ad", leads: "lead",
};

export function graphEntity(endpoint: string): ProductEvent["attributes"]["entityType"] {
  return ENTITY[endpoint.split("/").pop() ?? ""];
}

/** `META_100_1870188` for a Meta refusal, `META_HTTP_500` without a code, or a network reason. */
export function graphErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    const { code, subcode, status } = error as { code?: number; subcode?: number; status?: number };
    if (typeof code === "number") return `META_${code}${typeof subcode === "number" ? `_${subcode}` : ""}`;
    if (typeof status === "number") return `META_HTTP_${status}`;
  }
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" ? "META_TIMEOUT" : name === "AbortError" ? "META_ABORTED" : "META_NETWORK";
}

/** Meta's own 4xx refusals are "rejected"; 5xx, throttling, timeouts and network errors are "failed". */
export function graphOutcome(error: unknown): ProductEvent["outcome"] {
  if (!error) return "success";
  const status = error && typeof error === "object" && "status" in error ? (error as { status?: number }).status : undefined;
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: number }).code : undefined;
  const throttled = code === 4 || code === 17 || code === 32 || code === 613 || code === 80004;
  return typeof status === "number" && status >= 400 && status < 500 && !throttled ? "rejected" : "failed";
}
