import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { eventContext, newEventContext, observeIdentity, type EventContext } from "./context";
import { requestOutcome, sanitizeProductEvent, type ProductEventInput } from "./events";
export { currentRequestId } from "./context";

export function recordProductEvent(input: ProductEventInput): void {
  if (process.env.PRODUCT_LOGGING_ENABLED === "false") return;
  try {
    const activeContext = eventContext.getStore();
    const context = activeContext ?? newEventContext();
    const event = sanitizeProductEvent({
      ...input,
      version: 1,
      eventId: randomUUID(),
      requestId: context?.requestId ?? randomUUID(),
      occurredAt: new Date().toISOString(),
      userId: context?.userId ?? null,
      businessId: input.businessId ?? context?.businessId ?? null,
      attributes: {
        ...input.attributes,
        environment: process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : process.env.NODE_ENV === "test" ? "test" : "development",
        release: /^[a-f0-9]{7,40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA : undefined,
      },
    });
    if (!event) {
      console.warn(JSON.stringify({ source: "adbrain.telemetry", code: "INVALID_EVENT" }));
      return;
    }
    console.info(JSON.stringify({ source: "adbrain.product", ...event }));
    if (context.events.length < 100) context.events.push(event);
    else if (event.kind === "request" || event.kind === "action") context.events[99] = event;
    if (!activeContext) schedulePersistence(context);
  } catch {
    return;
  }
}

function schedulePersistence(context: EventContext): void {
  if (process.env.PRODUCT_LOGGING_DATABASE_ENABLED !== "true" || !context.events.length) return;
  try {
    after(async () => {
      try {
        const { persistProductEvents } = await import("./store");
        await persistProductEvents(context.events);
      } catch {
        console.warn(JSON.stringify({ source: "adbrain.telemetry", code: "PERSIST_FAILED", requestId: context.requestId }));
      }
    });
  } catch {
    console.warn(JSON.stringify({ source: "adbrain.telemetry", code: "SCHEDULE_FAILED", requestId: context.requestId }));
  }
}

export function observeRoute<Arguments extends unknown[], Result extends Response>(
  route: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS",
  handler: (...args: Arguments) => Promise<Result>,
): (...args: Arguments) => Promise<Result> {
  return (...args) => eventContext.run(newEventContext(), async () => {
    const context = eventContext.getStore()!;
    const started = performance.now();
    try {
      const response = await handler(...args);
      recordProductEvent({ kind: "request", name: "http.request", outcome: requestOutcome(response.status),
        durationMs: Math.round(performance.now() - started), attributes: { route, method, status: response.status } });
      try { response.headers.set("X-Request-Id", context.requestId); } catch {}
      return response;
    } catch (error) {
      recordProductEvent({ kind: "request", name: "http.request", outcome: "failed",
        durationMs: Math.round(performance.now() - started), attributes: { route, method, errorCode: "UNHANDLED_EXCEPTION" } });
      throw error;
    } finally {
      schedulePersistence(context);
    }
  });
}

export async function observeAction<Result>(name: string, handler: () => Promise<Result>): Promise<Result> {
  return eventContext.run(newEventContext(), async () => {
    const context = eventContext.getStore()!;
    const started = performance.now();
    try {
      try {
        const { createClient } = await import("@/lib/supabase/server");
        const { data, error } = await (await createClient()).auth.getUser();
        observeIdentity(error ? null : data.user?.id ?? null);
      } catch {}
      const result = await handler();
      const rejected = typeof result === "object" && result !== null && "ok" in result && result.ok === false;
      recordProductEvent({ kind: "action", name, outcome: rejected ? "rejected" : "success", durationMs: Math.round(performance.now() - started) });
      return result;
    } catch (error) {
      recordProductEvent({ kind: "action", name, outcome: "failed", durationMs: Math.round(performance.now() - started), attributes: { errorCode: "UNHANDLED_EXCEPTION" } });
      throw error;
    } finally {
      schedulePersistence(context);
    }
  });
}