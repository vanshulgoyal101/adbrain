import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { recordProductEvent } from "@/lib/observability/logger";
import { currentVerifiedActor } from "@/lib/observability/context";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const user = currentVerifiedActor() ?? (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error("Verified audit actor required.");

    recordProductEvent({ kind: "workflow", name: event.action, outcome: "success", businessId: event.businessId,
      attributes: { entityType: event.entityType } });
    const { error } = await createAdminClient().rpc("append_verified_audit_event", {
      p_business_id: event.businessId,
      p_actor_id: user.id,
      p_action: event.action,
      p_entity_type: event.entityType,
      p_entity_id: event.entityId ?? null,
      p_meta_object_id: event.metaObjectId ?? null,
      p_reason: event.reason ?? null,
      p_details: (event.details ?? {}) as unknown as Json,
    }).abortSignal(AbortSignal.timeout(3_000));
    if (error) recordProductEvent({ kind: "system", name: "audit.persist", outcome: "failed", businessId: event.businessId, attributes: { errorCode: "AUDIT_WRITE_FAILED" } });
  } catch {
    recordProductEvent({ kind: "system", name: "audit.persist", outcome: "failed", attributes: { errorCode: "AUDIT_WRITE_FAILED" } });
  }
}
