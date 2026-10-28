import type { Lead } from "@/lib/types";

/** Meta's Lead Ads testing tool fills every field with "<test lead: dummy data for …>" (#403). */
const TEST_PREFIX = "<test lead: dummy data";
/** The same match for a Postgres `ilike` (no `_` or `%` in the prefix to escape). */
export const META_TEST_LEAD_PATTERN = `${TEST_PREFIX}%`;

export function isMetaTestLead(lead: Pick<Lead, "full_name">): boolean {
  return (lead.full_name ?? "").toLowerCase().startsWith(TEST_PREFIX);
}

type TestLeadRow = Pick<Lead, "full_name" | "phone" | "email" | "city" | "form_name" | "workflow_status">;
type PageFilters = { query: string; status: string; contact: string };

/** #1149: whether `get_lead_page` counts this row under these filters (its SQL, in TS), so a Meta test lead can be taken off the total. */
export function inLeadPageFilters(lead: TestLeadRow, filters: PageFilters): boolean {
  if (filters.status !== "all" && lead.workflow_status !== filters.status) return false;
  const text = [lead.full_name, lead.phone, lead.email, lead.city, lead.form_name].filter((part) => part !== null && part !== undefined).join(" ").toLowerCase();
  if (filters.query && !text.includes(filters.query.toLowerCase())) return false;
  if (filters.contact === "all") return true;
  const reachable = Boolean(lead.phone?.trim() || lead.email?.trim());
  return reachable === (filters.contact === "ready");
}
