import { z } from "zod";

export const productPages = ["/dashboard", "/brand", "/create", "/studio", "/campaigns", "/leads", "/assets", "/settings"] as const;
export const clientEventSchema = z.object({
  name: z.enum(["page.view", "client.error", "client.rejection"]),
  page: z.enum(productPages),
}).strict();

export type ClientEvent = z.infer<typeof clientEventSchema>;