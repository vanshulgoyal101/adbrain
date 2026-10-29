/** #1824: creative tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { Database } from "./database";
export type CreativeStatus = "draft" | "approved";

export type CreativeTables = {
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
};

export type CreativeFunctions = {
  monthly_token_usage: {
    Args: { p_business_id: string; p_since: string };
    Returns: number;
  };
  /** #1717: the business's AI spend (USD) since p_since, text and pictures. */
  monthly_ai_cost_usd: {
    Args: { p_business_id: string; p_since: string };
    Returns: number;
  };
  creative_generation_admit: {
    Args: { p_business_id: string; p_user_id: string; p_generation_id: string; p_request_hash: string;
      p_expected_count: number; p_reserved_tokens: number; p_image_floor_tokens: number; p_monthly_limit: number };
    Returns: { action: "start" | "recover" | "missing" | "conflict" | "quota"; status?: string; expectedCount?: number };
  };
  creative_generation_status: {
    Args: { p_business_id: string; p_user_id: string; p_generation_id: string };
    Returns: { status: "unknown" | "processing" | "partial" | "complete" | "failed" | "unresolved"; expectedCount?: number };
  };
  creative_generation_progress: {
    Args: { p_business_id: string; p_user_id: string; p_generation_id: string;
      p_accounted_tokens?: number; p_complete?: boolean; p_uncertain?: boolean; p_failed?: boolean };
    Returns: { status: "unknown" | "processing" | "partial" | "complete" | "failed" | "unresolved"; count?: number; expectedCount?: number };
  };
  creative_regeneration_claim: {
    Args: { p_creative_id: string; p_business_id: string; p_user_id: string; p_attempt_id: string };
    Returns: { action: "start" | "busy" | "missing"; status?: "processing" | "unresolved" };
  };
  creative_regeneration_finish: {
    Args: { p_creative_id: string; p_business_id: string; p_user_id: string; p_attempt_id: string; p_unresolved: boolean };
    Returns: { status: "released" | "unresolved" | "missing" };
  };
};
