import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

export type AuditEntityType =
  | "business"
  | "creative"
  | "campaign"
  | "adset"
  | "ad"
  | "instruction"
  | "asset"
  | "lead";

export interface AuditEvent {
  businessId: string;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  metaObjectId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append an event to the audit log for observability (who/what/when/why).
 * Never throws — a logging failure must not break the main operation.
 */
export async function logEvent(event: AuditEvent): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("audit_log").insert({
      business_id: event.businessId,
      actor_id: user?.id ?? null,
      actor_label: user?.email ?? "system",
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      meta_object_id: event.metaObjectId ?? null,
      reason: event.reason ?? null,
      details: (event.details ?? {}) as unknown as Json,
    });
  } catch {
    // Swallow — audit logging is best-effort.
  }
}
