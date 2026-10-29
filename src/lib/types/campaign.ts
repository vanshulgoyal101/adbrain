/** #1824: campaign tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { Database } from "./database";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type CampaignTables = {
  campaigns: {
    Row: {
      destination?: "instant_form" | "whatsapp" | "call" | "mixed" | "unknown";
      id: string;
      business_id: string;
      name: string | null;
      objective: string;
      daily_budget: number | null;
      status: CampaignStatus;
      meta_campaign_id: string | null;
      meta_adset_id: string | null;
      meta_ad_ids: string[];
      meta_ad_account_id: string | null;
      meta_page_id: string | null;
      meta_connection_generation: number | null;
      creative_ids: string[];
      raw: Json | null;
      launched_at: string | null;
      created_at: string;
    };
    Insert: {
      id?: string;
      business_id: string;
      name?: string | null;
      objective: string;
      destination?: "instant_form" | "whatsapp" | "call" | "mixed" | "unknown";
      daily_budget?: number | null;
      status?: CampaignStatus;
      meta_campaign_id?: string | null;
      meta_adset_id?: string | null;
      meta_ad_ids?: string[];
      meta_ad_account_id?: string | null;
      meta_page_id?: string | null;
      meta_connection_generation?: number | null;
      creative_ids?: string[];
      raw?: Json | null;
      launched_at?: string | null;
      created_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["campaigns"]["Insert"]>;
    Relationships: [];
  };
  campaign_drafts: {
    Row: {
      id: string;
      business_id: string;
      owner_id: string;
      version: number;
      input: Json;
      expires_at: string;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      business_id: string;
      owner_id: string;
      version?: number;
      input: Json;
      expires_at: string;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["campaign_drafts"]["Insert"]>;
    Relationships: [];
  };
  campaign_operations: {
    Row: {
      id: string;
      business_id: string;
      draft_id: string;
      campaign_id: string | null;
      draft_version: number;
      connection_generation: number;
      kind: "campaign_create";
      idempotency_key: string;
      request_hash: string;
      state: "pending" | "running" | "succeeded" | "failed" | "needs_reconciliation";
      phase: "campaign" | "adset" | "creative" | "ad" | "reconcile" | "complete";
      lease_until: string | null;
      attempt_count: number;
      payload: Json;
      result: Json | null;
      external_ids: Json;
      sanitized_error: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      business_id: string;
      draft_id: string;
      campaign_id?: string | null;
      draft_version: number;
      connection_generation: number;
      kind?: "campaign_create";
      idempotency_key: string;
      request_hash: string;
      state?: "pending" | "running" | "succeeded" | "failed" | "needs_reconciliation";
      phase?: "campaign" | "adset" | "creative" | "ad" | "reconcile" | "complete";
      lease_until?: string | null;
      attempt_count?: number;
      payload?: Json;
      result?: Json | null;
      external_ids?: Json;
      sanitized_error?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["campaign_operations"]["Insert"]>;
    Relationships: [];
  };
  campaign_results: {
    Row: {
      destination?: "instant_form" | "whatsapp" | "call" | "mixed" | "unknown";
      period_start?: string | null;
      period_end?: string | null;
      id: string;
      campaign_id: string;
      impressions: number;
      clicks: number;
      leads: number;
      spend: number;
      cpl: number | null;
      conversations?: number | null;
      cost_per_conversation?: number | null;
      whatsapp_opens?: number | null;
      fetched_at: string;
    };
    Insert: {
      id?: string;
      campaign_id: string;
      impressions?: number;
      destination?: "instant_form" | "whatsapp" | "call" | "mixed" | "unknown";
      period_start?: string | null;
      period_end?: string | null;
      clicks?: number;
      leads?: number;
      spend?: number;
      cpl?: number | null;
      conversations?: number | null;
      cost_per_conversation?: number | null;
      whatsapp_opens?: number | null;
      fetched_at?: string;
    };
    Update: Partial<
      Database["public"]["Tables"]["campaign_results"]["Insert"]
    >;
    Relationships: [{
      foreignKeyName: "campaign_results_campaign_id_fkey";
      columns: ["campaign_id"];
      isOneToOne: false;
      referencedRelation: "campaigns";
      referencedColumns: ["id"];
    }];
  };
  spend_limits: {
    Row: {
      business_id: string;
      weekly_cap_rupees: number | null;
      alert_pct: number;
      auto_pause: boolean;
      updated_at: string;
    };
    Insert: {
      business_id: string;
      weekly_cap_rupees?: number | null;
      alert_pct?: number;
      auto_pause?: boolean;
      updated_at?: string;
    };
    Update: Partial<
      Database["public"]["Tables"]["spend_limits"]["Insert"]
    >;
    Relationships: [];
  };
};

export type CampaignFunctions = {
  enqueue_campaign_operation: {
    Args: { p_operation_id: string; p_input: Json; p_request_hash: string };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  claim_next_campaign_job: {
    Args: Record<string, never>;
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  delete_campaign_draft_if_version: {
    Args: { p_draft_id: string; p_expected_version: number };
    Returns: Database["public"]["Tables"]["campaign_drafts"]["Row"][];
  };
  update_campaign_draft_if_version: {
    Args: {
      p_draft_id: string;
      p_business_id: string;
      p_owner_id: string;
      p_expected_version: number;
      p_input: Json;
      p_now?: string;
    };
    Returns: Database["public"]["Tables"]["campaign_drafts"]["Row"][];
  };
  claim_campaign_operation: {
    Args: {
      p_operation_id: string;
      p_business_id: string;
      p_draft_id: string;
      p_draft_version: number;
      p_connection_generation: number;
      p_kind: "campaign_create";
      p_idempotency_key: string;
      p_request_hash: string;
      p_lease_until: string;
      p_payload?: Json;
      p_now?: string;
    };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  checkpoint_campaign_operation: {
    Args: {
      p_operation_id: string;
      p_business_id: string;
      p_connection_generation: number;
      p_phase: "campaign" | "adset" | "creative" | "ad" | "reconcile" | "complete";
      p_lease_until: string | null;
      p_external_ids: Json;
      p_campaign_id?: string | null;
      p_now?: string;
    };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  fail_campaign_operation: {
    Args: {
      p_operation_id: string;
      p_business_id: string;
      p_connection_generation: number;
      p_state: string;
      p_external_ids: Json;
      p_campaign_id?: string | null;
      p_error?: string | null;
    };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  expire_campaign_operation: {
    Args: { p_operation_id: string; p_business_id: string };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
  finish_campaign_operation: {
    Args: {
      p_operation_id: string;
      p_business_id: string;
      p_connection_generation: number;
      p_campaign_id: string;
      p_result: Json;
      p_now?: string;
    };
    Returns: Database["public"]["Tables"]["campaign_operations"]["Row"][];
  };
};
