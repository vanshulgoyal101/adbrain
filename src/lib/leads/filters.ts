import { z } from "zod";

export const workflowStatuses = ["new", "contacted", "qualified", "booked", "closed"] as const;
export type WorkflowStatus = typeof workflowStatuses[number];

export const leadListSchema = z.object({
  query: z.string().trim().max(200).default(""),
  status: z.enum(["all", ...workflowStatuses]).default("all"),
  contact: z.enum(["all", "ready", "missing"]).default("all"),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(16000).optional(),
}).strict();

export type LeadFilters = z.infer<typeof leadListSchema>;

export const leadUpdateSchema = z.object({
  workflow_status: z.enum(workflowStatuses).optional(),
  follow_up_note: z.string().max(2000).optional(),
}).strict().refine(update => Object.keys(update).length > 0);