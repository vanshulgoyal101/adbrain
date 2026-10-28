import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";
import { leadListSchema } from "./filters";
import { inLeadPageFilters, META_TEST_LEAD_PATTERN } from "./test-lead";

const positionSchema = z.object({ id: z.uuid(), key: z.string().max(8000), missing: z.boolean() }).strict();
const cursorSchema = z.object({
  businessId: z.uuid(), query: z.string(), status: z.string(), contact: z.string(), sort: z.string(),
  position: positionSchema,
}).strict();

export type LeadPage = { leads: Lead[]; total: number; nextCursor: string | null };

export async function getLeadPage(businessId: string, input: unknown = {}): Promise<LeadPage> {
  const filters = leadListSchema.parse(input);
  const scope = { businessId, query: filters.query, status: filters.status, contact: filters.contact, sort: filters.sort };
  let position: z.infer<typeof positionSchema> | undefined;
  if (filters.cursor) {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8")));
    if (Object.entries(scope).some(([key, value]) => cursor[key as keyof typeof scope] !== value)) {
      throw new SyntaxError("Cursor does not match filters");
    }
    position = cursor.position;
  }
  const database = await createClient();
  const { data, error } = await database.rpc("get_lead_page", {
    p_business_id: businessId, p_query: filters.query, p_status: filters.status,
    p_contact: filters.contact, p_sort: filters.sort, p_limit: filters.limit,
    ...(position ? { p_after_id: position.id, p_after_key: position.key, p_after_null: position.missing } : {}),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Enquiries unavailable");
  if (!Array.isArray(data.leads) || typeof data.total !== "number") throw new Error("Invalid enquiry page");
  const next = data.nextCursor === null ? null : positionSchema.parse(data.nextCursor);
  // #1149: Meta's test leads stay listed (labelled) but never count, the same as Home. An unreadable read keeps the total.
  let tests = 0;
  if (data.total > 0) {
    const { data: rows, error: testError } = await database.from("leads").select("full_name, phone, email, city, form_name, workflow_status")
      .eq("business_id", businessId).ilike("full_name", META_TEST_LEAD_PATTERN).limit(1000);
    if (!testError && rows) tests = rows.filter((row) => inLeadPageFilters(row, filters)).length;
  }
  return {
    leads: data.leads as Lead[], total: Math.max(0, data.total - tests),
    nextCursor: next ? Buffer.from(JSON.stringify({ ...scope, position: next })).toString("base64url") : null,
  };
}