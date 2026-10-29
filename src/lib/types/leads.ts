/** #1824: leads tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";
import type { Database } from "./database";
export type LeadSyncScopeArgs = {
  p_business_id: string;
  p_owner_id: string;
  p_sync_id: string | null;
  p_generation: number;
  p_ad_account_id: string;
  p_page_id: string;
};

export type LeadSyncRow = {
  id: string;
  business_id: string;
  owner_id: string;
  generation: number;
  ad_account_id: string;
  page_id: string;
  state: "partial" | "complete";
  version: number;
  progress: Json;
  created_at: string;
  updated_at: string;
};

export type LeadsTables = {
  lead_sync_runs: {
    Row: LeadSyncRow;
    Insert: Omit<LeadSyncRow, "id" | "version" | "state" | "progress" | "created_at" | "updated_at"> & Partial<LeadSyncRow>;
    Update: Partial<LeadSyncRow>;
    Relationships: [];
  };
  leads: {
    Row: {
      id: string;
      business_id: string;
      campaign_id: string | null;
      /** Null exactly for enquiries the owner logged from WhatsApp chats (#335). */
      meta_lead_id: string | null;
      source: "meta_form" | "whatsapp_manual";
      form_id: string | null;
      form_name: string | null;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      city: string | null;
      field_data: Json;
      created_time: string | null;
      created_at: string;
      workflow_status: "new" | "contacted" | "qualified" | "booked" | "customer" | "closed";
      follow_up_note: string;
      first_contacted_at: string | null;
    };
    Insert: {
      id?: string;
      business_id: string;
      campaign_id?: string | null;
      meta_lead_id?: string | null;
      source?: "meta_form" | "whatsapp_manual";
      form_id?: string | null;
      form_name?: string | null;
      full_name?: string | null;
      phone?: string | null;
      email?: string | null;
      city?: string | null;
      field_data?: Json;
      created_time?: string | null;
      created_at?: string;
      workflow_status?: "new" | "contacted" | "qualified" | "booked" | "customer" | "closed";
      follow_up_note?: string;
      first_contacted_at?: string | null;
    };
    Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
    Relationships: [];
  };
};

export type LeadsFunctions = {
  get_lead_page: {
    Args: {
      p_business_id: string; p_query: string; p_status: string; p_contact: string;
      p_sort: string; p_limit: number; p_after_id?: string; p_after_key?: string; p_after_null?: boolean;
    };
    Returns: Json;
  };
  leads_erase: {
    Args: { p_business_id: string; p_lead_id?: string; p_campaign_id?: string };
    Returns: number;
  };
  lead_sync_checkpoint: {
    Args: LeadSyncScopeArgs & { p_sync_id: string; p_version: number; p_rows: Json; p_progress: Json };
    Returns: Json;
  };
};
