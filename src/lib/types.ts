/**
 * Database types for AdBrain, matching db/schema.sql.
 *
 * These are hand-authored to mirror the schema. If you later run the Supabase
 * CLI (`supabase gen types typescript`), you can replace this file with the
 * generated output — the app only imports `Database` and the aliases below.
 */

/** The customer's industry / business type, e.g. "solar energy", "dental clinic". Free text. */
export type Vertical = string;
export type BrandAssetType = "logo" | "product_photo" | "past_ad";
export type MetaAuthorizationStatus =
  | "disconnected"
  | "connected"
  | "reauth_required"
  | "revoked";
export type CreativeStatus = "draft" | "approved";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string | null; created_at: string };
        Insert: { id: string; email?: string | null; created_at?: string };
        Update: { id?: string; email?: string | null; created_at?: string };
        Relationships: [];
      };
      llm_usage_events: {
        Row: {
          id: string;
          business_id: string;
          user_id: string | null;
          route: string;
          usage_kind: "text" | "image";
          provider: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          estimated_cost_usd: number;
          prompt_version: string | null;
          input_chars: number;
          output_chars: number;
          temperature: number | null;
          max_tokens: number | null;
          cache_hit: boolean;
          latency_ms: number | null;
          attempt: number;
          status: "success" | "error" | "fallback";
          error_code: string | null;
          image_width: number | null;
          image_height: number | null;
          metadata: Json;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id?: string | null;
          route: string;
          usage_kind?: "text" | "image";
          provider: string;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          estimated_cost_usd?: number;
          prompt_version?: string | null;
          input_chars?: number;
          output_chars?: number;
          temperature?: number | null;
          max_tokens?: number | null;
          cache_hit?: boolean;
          latency_ms?: number | null;
          attempt?: number;
          status?: "success" | "error" | "fallback";
          error_code?: string | null;
          image_width?: number | null;
          image_height?: number | null;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["llm_usage_events"]["Insert"]>;
        Relationships: [];
      };
      businesses: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          vertical: Vertical;
          website: string | null;
          description: string | null;
          brand_voice: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          font: string | null;
          languages: string[];
          locations: string[];
          target_audience: string | null;
          usps: string[];
          offers: string[];
          logo_url: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          vertical?: Vertical;
          website?: string | null;
          description?: string | null;
          brand_voice?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          font?: string | null;
          languages?: string[];
          locations?: string[];
          target_audience?: string | null;
          usps?: string[];
          offers?: string[];
          logo_url?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Insert"]>;
        Relationships: [];
      };
      brand_assets: {
        Row: {
          id: string;
          business_id: string;
          type: BrandAssetType;
          url: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          type: BrandAssetType;
          url: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["brand_assets"]["Insert"]>;
        Relationships: [];
      };
      meta_connections: {
        Row: {
          business_id: string;
          token_id: string | null;
          meta_business_id: string | null;
          ad_account_id: string | null;
          page_id: string | null;
          account_name: string | null;
          page_name: string | null;
          currency: string | null;
          timezone_name: string | null;
          authorization_status: MetaAuthorizationStatus;
          capabilities: Json;
          selection_reason: string | null;
          generation: number;
          last_checked_at: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          token_id?: string | null;
          meta_business_id?: string | null;
          ad_account_id?: string | null;
          page_id?: string | null;
          account_name?: string | null;
          page_name?: string | null;
          currency?: string | null;
          timezone_name?: string | null;
          authorization_status?: MetaAuthorizationStatus;
          capabilities?: Json;
          selection_reason?: string | null;
          generation?: number;
          last_checked_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meta_connections"]["Insert"]>;
        Relationships: [];
      };
      creatives: {
        Row: {
          generation?: Json | null;
          id: string;
          business_id: string;
          brief: string;
          angle: string | null;
          image_url: string | null;
          headline: string | null;
          primary_text: string | null;
          cta: string | null;
          variant_group: string | null;
          status: CreativeStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          brief: string;
          generation?: Json | null;
          angle?: string | null;
          image_url?: string | null;
          headline?: string | null;
          primary_text?: string | null;
          cta?: string | null;
          variant_group?: string | null;
          status?: CreativeStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["creatives"]["Insert"]>;
        Relationships: [];
      };
      campaigns: {
        Row: {
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
          id: string;
          campaign_id: string;
          impressions: number;
          clicks: number;
          leads: number;
          spend: number;
          cpl: number | null;
          fetched_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          impressions?: number;
          clicks?: number;
          leads?: number;
          spend?: number;
          cpl?: number | null;
          fetched_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["campaign_results"]["Insert"]
        >;
        Relationships: [];
      };
      ad_instructions: {
        Row: {
          id: string;
          business_id: string;
          title: string;
          content: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          title: string;
          content?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["ad_instructions"]["Insert"]
        >;
        Relationships: [];
      };
      audit_log: {
        Row: {
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
      leads: {
        Row: {
          id: string;
          business_id: string;
          campaign_id: string | null;
          meta_lead_id: string;
          form_id: string | null;
          form_name: string | null;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          city: string | null;
          field_data: Json;
          created_time: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          campaign_id?: string | null;
          meta_lead_id: string;
          form_id?: string | null;
          form_name?: string | null;
          full_name?: string | null;
          phone?: string | null;
          email?: string | null;
          city?: string | null;
          field_data?: Json;
          created_time?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
        Relationships: [];
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
    Views: Record<string, never>;
    Functions: {
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number };
        Returns: { allowed: boolean; retry_after_ms: number }[];
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
      meta_token_insert: {
        Args: {
          p_id: string;
          p_business_id: string;
          p_authorized_by: string;
          p_subject_id: string;
          p_token_kind: "user" | "business_system_user" | "page";
          p_ciphertext: string;
          p_nonce: string;
          p_auth_tag: string;
          p_key_id: string;
          p_format_version: string;
          p_granted_scopes: string[];
          p_granted_assets: Json;
          p_expires_at: string | null;
          p_validated_at: string | null;
          p_data_access_expires_at?: string | null;
        };
        Returns: string;
      };
      meta_token_get: {
        Args: { p_token_id: string; p_business_id: string };
        Returns: {
          id: string;
          business_id: string;
          ciphertext: string;
          nonce: string;
          auth_tag: string;
          key_id: string;
          format_version: string;
          expires_at: string | null;
          revoked_at: string | null;
          granted_scopes: string[];
          data_access_expires_at: string | null;
        }[];
      };
      meta_token_delete: {
        Args: { p_token_id: string; p_business_id: string };
        Returns: boolean;
      };
      meta_attempt_create: {
        Args: {
          p_id: string;
          p_business_id: string;
          p_user_id: string;
          p_state_hash: string;
          p_browser_binding_hash: string;
          p_status: string;
          p_intent: Json;
          p_expected_generation: number;
          p_expires_at: string;
        };
        Returns: string;
      };
      meta_attempt_claim: {
        Args: { p_state_hash: string; p_user_id: string; p_browser_binding_hash: string };
        Returns: { attempt_id: string; business_id: string; user_id: string; status: string }[];
      };
      meta_attempt_get: {
        Args: { p_attempt_id: string; p_user_id: string };
        Returns: {
          id: string;
          business_id: string;
          user_id: string;
          token_id: string | null;
          intent: Json;
          status: string;
          revision: number;
          discovered_assets: Json | null;
          discovery_complete: boolean;
          error_code: string | null;
          expires_at: string;
        }[];
      };
      meta_attempt_set_discovering: {
        Args: { p_attempt_id: string; p_retry?: boolean };
        Returns: boolean;
      };
      meta_attempt_attach_token: {
        Args: { p_attempt_id: string; p_token_id: string };
        Returns: boolean;
      };
      meta_attempt_action_required: {
        Args: { p_attempt_id: string; p_discovered_assets: Json };
        Returns: boolean;
      };
      meta_attempt_discovery_result: {
        Args: {
          p_attempt_id: string;
          p_discovered_assets: Json;
          p_status: "selection_required" | "action_required";
          p_error_code: string | null;
        };
        Returns: boolean;
      };
      meta_attempt_failed: {
        Args: { p_attempt_id: string; p_error_code: string };
        Returns: boolean;
      };
      meta_attempt_cancelled: {
        Args: { p_attempt_id: string };
        Returns: boolean;
      };
      meta_attempt_commit_selection: {
        Args: {
          p_attempt_id: string;
          p_user_id: string;
          p_pair_id: string;
          p_revision: number;
          p_confirm_replacement: boolean;
        };
        Returns: boolean;
      };
      meta_attempt_retry_claim: {
        Args: { p_attempt_id: string; p_user_id: string; p_revision: number };
        Returns: boolean;
      };
      meta_disconnect: {
        Args: { p_business_id: string; p_user_id: string };
        Returns: boolean;
      };
      meta_revoke_subject: {
        Args: { p_subject_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  private: {
    Tables: {
      meta_tokens: {
        Row: {
          id: string;
          business_id: string;
          authorized_by: string;
          subject_id: string;
          token_kind: "user" | "business_system_user" | "page";
          ciphertext: string;
          nonce: string;
          auth_tag: string;
          key_id: string;
          format_version: string;
          granted_scopes: string[];
          granted_assets: Json;
          expires_at: string | null;
          data_access_expires_at: string | null;
          validated_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          authorized_by: string;
          subject_id: string;
          token_kind: "user" | "business_system_user" | "page";
          ciphertext: string;
          nonce: string;
          auth_tag: string;
          key_id: string;
          format_version?: string;
          granted_scopes?: string[];
          granted_assets?: Json;
          expires_at?: string | null;
          data_access_expires_at?: string | null;
          validated_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["private"]["Tables"]["meta_tokens"]["Insert"]>;
        Relationships: [];
      };
      meta_connection_attempts: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          token_id: string | null;
          state_hash: string;
          browser_binding_hash: string;
          status: string;
          intent: Json;
          expected_generation: number;
          revision: number;
          discovered_assets: Json | null;
          discovery_complete: boolean;
          error_code: string | null;
          claimed_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          token_id?: string | null;
          state_hash: string;
          browser_binding_hash: string;
          status: string;
          intent: Json;
          expected_generation?: number;
          revision?: number;
          discovered_assets?: Json | null;
          discovery_complete?: boolean;
          error_code?: string | null;
          claimed_at?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<Database["private"]["Tables"]["meta_connection_attempts"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Business = Database["public"]["Tables"]["businesses"]["Row"];
export type BrandAsset = Database["public"]["Tables"]["brand_assets"]["Row"];
export type Creative = Database["public"]["Tables"]["creatives"]["Row"];
export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
export type CampaignResult =
  Database["public"]["Tables"]["campaign_results"]["Row"];
export type AdInstruction =
  Database["public"]["Tables"]["ad_instructions"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_log"]["Row"];
export type Lead = Database["public"]["Tables"]["leads"]["Row"];
export type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];
export type SpendLimitRow =
  Database["public"]["Tables"]["spend_limits"]["Row"];

export type BusinessInsert =
  Database["public"]["Tables"]["businesses"]["Insert"];
export type BusinessUpdate =
  Database["public"]["Tables"]["businesses"]["Update"];
export type CreativeInsert =
  Database["public"]["Tables"]["creatives"]["Insert"];
