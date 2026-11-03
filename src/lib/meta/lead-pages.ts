// Meta's paged lead-form and lead reads: bounded pages with a validated cursor, at most 100 pages.
import { z } from "zod";
import { MetaError } from "./client";

export interface MetaLeadPage<T> {
  data: T[];
  after: string | null;
}

export const formPageSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(1000), status: z.string() });
export const leadPageSchema = z.object({
  id: z.string().min(1).max(200),
  created_time: z.string().refine(value => !value || Number.isFinite(Date.parse(value))).optional().default(""),
  field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
  campaign_id: z.string().regex(/^\d{1,64}$/).optional().catch(undefined),
});

export function parseLeadPage<T>(value: unknown, schema: z.ZodType<T>, previous?: string | null): MetaLeadPage<T> {
  const page = z.object({
    data: z.array(schema).max(200),
    paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).max(4096) }).partial().optional() }).optional(),
  }).safeParse(value);
  if (!page.success) throw new MetaError("Malformed Meta lead page.");
  const after = page.data.paging?.next ? page.data.paging.cursors?.after : null;
  if (after === undefined || (after !== null && (after === previous || !/^[A-Za-z0-9_+/=-]+$/.test(after)))) {
    throw new MetaError("Invalid Meta lead page cursor.");
  }
  return { data: page.data.data, after };
}

export async function collectLeadPages<T>(read: (after: string | null) => Promise<MetaLeadPage<T>>): Promise<T[]> {
  const values: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let count = 0; count < 100; count++) {
    const page = await read(after);
    values.push(...page.data);
    if (!page.after) return values;
    if (seen.has(page.after)) throw new MetaError("Repeated Meta lead page cursor.");
    seen.add(page.after);
    after = page.after;
  }
  throw new MetaError("Meta lead page limit exceeded; use resumable sync.");
}
