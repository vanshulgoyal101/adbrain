/**
 * Database types for AdBrain, matching db/schema.sql.
 *
 * These are hand-authored to mirror the schema. If you later run the Supabase
 * CLI (`supabase gen types typescript`), you can replace this file with the
 * generated output — the app only imports `Database` and the aliases below.
 */

export type Vertical = "solar";
export type BrandAssetType = "logo" | "product_photo" | "past_ad";
export type MetaTokenType = "system_user" | "oauth";
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
      meta_credentials: {
        Row: {
          id: string;
          business_id: string;
          ad_account_id: string;
          page_id: string;
          access_token: string;
          token_type: MetaTokenType;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          ad_account_id: string;
          page_id: string;
          access_token: string;
          token_type?: MetaTokenType;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["meta_credentials"]["Insert"]
        >;
        Relationships: [];
      };
      creatives: {
        Row: {
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
          creative_ids?: string[];
          raw?: Json | null;
          launched_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["campaigns"]["Insert"]>;
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
export type MetaCredential =
  Database["public"]["Tables"]["meta_credentials"]["Row"];
export type Creative = Database["public"]["Tables"]["creatives"]["Row"];
export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
export type CampaignResult =
  Database["public"]["Tables"]["campaign_results"]["Row"];
export type AdInstruction =
  Database["public"]["Tables"]["ad_instructions"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_log"]["Row"];

export type BusinessInsert =
  Database["public"]["Tables"]["businesses"]["Insert"];
export type BusinessUpdate =
  Database["public"]["Tables"]["businesses"]["Update"];
export type CreativeInsert =
  Database["public"]["Tables"]["creatives"]["Insert"];
