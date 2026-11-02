/** #1824: convenience row aliases for the tables the app reads most (moved from types.ts). */
import type { Database } from "./database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Business = Database["public"]["Tables"]["businesses"]["Row"];
export type BrandAsset = Database["public"]["Tables"]["brand_assets"]["Row"];
export type Creative = Database["public"]["Tables"]["creatives"]["Row"];
export type CreativePreview = Pick<Creative, "id" | "headline" | "image_url" | "status" | "angle" | "created_at" | "variant_group">;
export type Campaign = Database["public"]["Tables"]["campaigns"]["Row"];
export type CampaignResult =
  Database["public"]["Tables"]["campaign_results"]["Row"] & {
    /** Real enquiries the owner logged from this WhatsApp campaign's chats (#335); not a stored column. */
    real_enquiries?: number;
    /** Enquiries the owner marked "Became a customer" (#798); not a stored column. */
    customers?: number;
    /** #1994: enquiries marked Booked or Customer; not a stored column. */
    booked?: number;
  };
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
