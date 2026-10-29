/**
 * #1824: the Supabase `Database` type, assembled from per-domain table and function types (business, creative,
 * campaign, meta, leads, payments, system). Hand-authored to mirror db/schema.sql; the app imports it through
 * `@/lib/types`.
 */
import type { Json } from "./json";
import type { BusinessFunctions, BusinessTables } from "./business";
import type { CreativeFunctions, CreativeTables } from "./creative";
import type { CampaignFunctions, CampaignTables } from "./campaign";
import type { MetaFunctions, MetaTables } from "./meta";
import type { LeadsFunctions, LeadsTables } from "./leads";
import type { PaymentsFunctions, PaymentsTables } from "./payments";
import type { SystemFunctions, SystemTables } from "./system";

/** The `private` schema (service-only Meta token storage). */
export type PrivateTables = {
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

export interface Database {
  public: {
    Tables: BusinessTables
      & CreativeTables
      & CampaignTables
      & MetaTables
      & LeadsTables
      & PaymentsTables
      & SystemTables;
    Views: Record<string, never>;
    Functions: BusinessFunctions
      & CreativeFunctions
      & CampaignFunctions
      & MetaFunctions
      & LeadsFunctions
      & PaymentsFunctions
      & SystemFunctions;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  private: {
    Tables: PrivateTables;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
