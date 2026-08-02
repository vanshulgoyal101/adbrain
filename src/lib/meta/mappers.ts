import type { CampaignStatus } from "@/lib/types";

/** Map a Meta campaign status to our internal status enum. */
export function mapCampaignStatus(s: string): CampaignStatus {
  switch ((s ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
      return "paused";
    case "ARCHIVED":
    case "DELETED":
    case "COMPLETED":
      return "completed";
    default:
      return "draft";
  }
}

/** Map a Meta campaign objective (OUTCOME_*) to a friendly short label. */
export function mapCampaignObjective(o: string): string {
  const m = (o ?? "").toUpperCase();
  if (!m) return "leads";
  if (m.includes("LEAD")) return "leads";
  if (m.includes("TRAFFIC")) return "traffic";
  if (m.includes("SALES") || m.includes("CONVERSION")) return "sales";
  if (m.includes("ENGAGEMENT")) return "engagement";
  if (m.includes("AWARENESS")) return "awareness";
  if (m.includes("APP")) return "app";
  return m.replace(/^OUTCOME_/, "").toLowerCase();
}
