import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeProductEvent, type ProductEvent } from "./events";

export async function persistProductEvents(events: ProductEvent[]): Promise<void> {
  if (!events.length) return;
  const rows = events.slice(0, 100).map(sanitizeProductEvent).filter(event => event !== null).map(event => ({
    event_id: event.eventId,
    request_id: event.requestId,
    version: event.version,
    created_at: event.occurredAt,
    user_id: event.userId,
    business_id: event.businessId,
    kind: event.kind,
    name: event.name,
    outcome: event.outcome,
    duration_ms: event.durationMs ?? null,
    attributes: event.attributes,
  }));
  if (!rows.length) return;
  const { error } = await createAdminClient().from("product_events").insert(rows).abortSignal(AbortSignal.timeout(3_000));
  if (error) throw new Error("Product events could not be persisted.");
}