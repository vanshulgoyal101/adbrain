/** #1824: meta tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { Database } from "./database";
export type MetaTokenType = "system_user" | "oauth";

export type MetaAuthorizationStatus =
  | "disconnected"
  | "connected"
  | "reauth_required"
  | "revoked";

export type MetaTables = {
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
  managed_meta_accounts: {
    Row: {
      business_id: string;
      state: "requested" | "page_linked" | "child_created" | "ad_account_created" | "funded" | "whatsapp_linked" | "ready" | "failed" | "offboarding" | "offboarded";
      page_id: string | null;
      child_business_id: string | null;
      ad_account_id: string | null;
      waba_id: string | null;
      phone_number_id: string | null;
      funding_state: "none" | "card_attached" | "invoiced" | "failed";
      step_keys: Json;
      last_error: string | null;
      /** #521: the child's own system user, and a reference to its token in the encrypted store (never the token). */
      manager_user_id: string | null;
      manager_token_id: string | null;
      provision_lease_id: string | null;
      provision_lease_until: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      business_id: string;
      state?: Database["public"]["Tables"]["managed_meta_accounts"]["Row"]["state"];
      page_id?: string | null;
      child_business_id?: string | null;
      ad_account_id?: string | null;
      waba_id?: string | null;
      phone_number_id?: string | null;
      funding_state?: Database["public"]["Tables"]["managed_meta_accounts"]["Row"]["funding_state"];
      step_keys?: Json;
      last_error?: string | null;
      manager_user_id?: string | null;
      manager_token_id?: string | null;
    };
    Update: Partial<Database["public"]["Tables"]["managed_meta_accounts"]["Insert"]>;
    Relationships: [];
  };
  managed_meta_account_events: {
    Row: {
      id: number;
      business_id: string;
      step: "page" | "child_business" | "ad_account" | "funding" | "whatsapp" | "offboard";
      outcome: "started" | "succeeded" | "failed" | "reconciled";
      request_id: string | null;
      idempotency_key: string | null;
      meta_object_id: string | null;
      error_code: string | null;
      created_at: string;
    };
    Insert: Omit<Database["public"]["Tables"]["managed_meta_account_events"]["Row"], "id" | "created_at" | "request_id" | "idempotency_key" | "meta_object_id" | "error_code"> & {
      request_id?: string | null;
      idempotency_key?: string | null;
      meta_object_id?: string | null;
      error_code?: string | null;
    };
    Update: never;
    Relationships: [];
  };
  whatsapp_number_bindings: {
    Row: {
      business_id: string;
      phone_e164: string;
      source: "owner_pick" | "embedded_signup" | "page_link";
      waba_id: string | null;
      phone_number_id: string | null;
      created_at: string;
    };
    Insert: Omit<Database["public"]["Tables"]["whatsapp_number_bindings"]["Row"], "created_at" | "waba_id" | "phone_number_id"> & {
      waba_id?: string | null;
      phone_number_id?: string | null;
    };
    Update: never;
    Relationships: [];
  };
};

export type MetaFunctions = {
  managed_meta_account_claim: {
    Args: { p_business_id: string; p_lease_id: string; p_seconds: number };
    Returns: boolean;
  };
  managed_meta_account_release: {
    Args: { p_business_id: string; p_lease_id: string };
    Returns: boolean;
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
  meta_funding_latest_record: {
    Args: { p_business_id: string; p_environment: "test" | "live" };
    Returns: Json;
  };
  meta_billing_event_record: {
    Args: { p_business_id: string; p_environment: "test" | "live"; p_record: Json;
      p_actor_id: string; p_source: string; p_source_reference: string };
    Returns: string;
  };
  meta_billing_charge_observations: {
    Args: { p_business_id: string; p_environment: "test" | "live"; p_charge_id: string };
    Returns: Json;
  };
  meta_revoke_subject: {
    Args: { p_subject_id: string };
    Returns: number;
  };
  meta_connection_mark_reauth: {
    Args: { p_business_id: string; p_generation: number };
    Returns: boolean;
  };
  meta_deletion_request_record: {
    Args: { p_subject_id: string; p_code: string };
    Returns: number;
  };
};
