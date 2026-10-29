/** #1824: system tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { LeadSyncRow, LeadSyncScopeArgs } from "./leads";
import type { Database } from "./database";
export type ProductEventRow = {
  event_id: string;
  request_id: string;
  version: number;
  created_at: string;
  user_id: string | null;
  business_id: string | null;
  kind: string;
  name: string;
  outcome: string;
  duration_ms: number | null;
  attributes: Json;
};

export type SystemTables = {
  product_events: {
    Row: ProductEventRow;
    Insert: ProductEventRow;
    Update: Partial<ProductEventRow>;
    Relationships: [];
  };
  audit_log: {
    Row: {
      authority: "legacy_unverified" | "server";
      id: string;
      business_id: string | null;
      actor_id: string | null;
      actor_label: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      meta_object_id: string | null;
      reason: string | null;
      details: Json;
      created_at: string;
    };
    Insert: {
      authority?: "legacy_unverified" | "server";
      id?: string;
      business_id?: string | null;
      actor_id?: string | null;
      actor_label?: string | null;
      action: string;
      entity_type: string;
      entity_id?: string | null;
      meta_object_id?: string | null;
      reason?: string | null;
      details?: Json;
      created_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
    Relationships: [];
  };
};

export type SystemFunctions = {
  append_verified_audit_event: {
    Args: { p_business_id: string; p_actor_id: string | null; p_action: string; p_entity_type: string;
      p_entity_id?: string | null; p_meta_object_id?: string | null; p_reason?: string | null;
      p_details?: Json; p_system_actor?: "cron" | "worker" | null };
    Returns: string;
    };
  lead_sync_start: {
    Args: LeadSyncScopeArgs;
    Returns: LeadSyncRow[];
  };
  prune_product_events: {
    Args: Record<string, never>;
    Returns: number;
  };
  check_rate_limit: {
    Args: { p_key: string; p_limit: number; p_window_ms: number };
    Returns: { allowed: boolean; retry_after_ms: number }[];
  };
};
