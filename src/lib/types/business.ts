/** #1824: business tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { Database } from "./database";
/** The customer's industry / business type, e.g. "solar energy", "dental clinic". Free text. */
export type Vertical = string;

export type BrandAssetType = "logo" | "product_photo" | "past_ad";

/** #701: one business's WhatsApp alert opt-in (`owner_alert_prefs`). */
export type OwnerAlertPrefsRow = {
  business_id: string; owner_id: string; lead_alerts: boolean; daily_results: boolean; language: "en" | "hi";
  phone_e164: string | null; verified_at: string | null; verify_code: string | null; verify_expires_at: string | null;
  opted_out_at: string | null; created_at: string; updated_at: string;
};

export type BusinessTables = {
  privacy_requests: {
    Row: { id: string; owner_id: string | null; kind: "export" | "delete"; status: "received" | "in_review" | "completed" | "declined"; handled_by: string | null; source: "owner" | "meta_callback"; confirmation_code: string | null; meta_subject_id: string | null; created_at: string; updated_at: string };
    Insert: { id?: string; owner_id: string; kind: "export" | "delete"; status?: "received" | "in_review" | "completed" | "declined"; handled_by?: string | null; created_at?: string; updated_at?: string };
    Update: Partial<Database["public"]["Tables"]["privacy_requests"]["Insert"]>;
    Relationships: [];
  };
  preference_settings: {
    Row: { business_id: string; owner_id: string; enabled: boolean; epoch: number; updated_at: string };
    Insert: { business_id: string; owner_id: string; enabled?: boolean; epoch?: number; updated_at?: string };
    Update: Partial<Database["public"]["Tables"]["preference_settings"]["Insert"]>;
    Relationships: [];
  };
  owner_alert_prefs: {
    Row: OwnerAlertPrefsRow;
    Insert: Partial<OwnerAlertPrefsRow> & { business_id: string; owner_id: string };
    Update: Partial<OwnerAlertPrefsRow>;
    Relationships: [];
  };
  owner_alert_consent_events: {
    Row: { id: number; business_id: string; event: "preferences" | "verified" | "opted_out"; method: "settings" | "whatsapp_start" | "whatsapp_stop"; detail: Json; occurred_at: string };
    Insert: { business_id: string; event: "preferences" | "verified" | "opted_out"; method: "settings" | "whatsapp_start" | "whatsapp_stop"; detail?: Json; occurred_at?: string };
    Update: never;
    Relationships: [];
  };
  declared_preferences: {
    Row: { business_id: string; owner_id: string; category: string; value: string; version: number; updated_at: string };
    Insert: { business_id: string; owner_id: string; category: string; value: string; version?: number; updated_at?: string };
    Update: Partial<Database["public"]["Tables"]["declared_preferences"]["Insert"]>;
    Relationships: [];
  };
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
      phone: string | null;
      email: string | null;
      whatsapp_template: Json | null;
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
      whatsapp_template?: Json | null;
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
};

export type BusinessFunctions = {
  owner_alert_prefs_set: {
    Args: { p_business_id: string; p_lead_alerts: boolean; p_daily_results: boolean; p_language: "en" | "hi" };
    Returns: OwnerAlertPrefsRow;
  };
  owner_alert_start_verification: { Args: { p_business_id: string }; Returns: string };
  owner_alert_confirm: { Args: { p_code: string; p_phone: string }; Returns: string | null };
  owner_alert_stop: { Args: { p_phone: string }; Returns: number };
  change_declared_preferences: {
    Args: { p_business_id: string; p_operation: "enable" | "pause" | "save" | "forget" | "clear";
      p_expected_epoch: number; p_category?: string | null; p_value?: string | null };
    Returns: number;
  };
  privacy_request_operator_allowed: { Args: { p_user_id: string }; Returns: boolean };
};
