import { z } from "zod";

export const productPages = ["/dashboard", "/brand", "/create", "/studio", "/campaigns", "/leads", "/assets", "/settings"] as const;
export const productActions = ["creative.generate", "creative.regenerate", "creative.inspect", "creative.approve", "creative.unapprove", "creative.download",
  "campaign.create", "campaign.review", "campaign.activate", "campaign.pause", "campaign.sync", "brand.save", "asset.upload", "asset.delete",
  "lead.follow_up", "payment.checkout", "payment.quote", "meta.connect"] as const;
export const viewportSchema = z.enum(["compact", "medium", "wide"]);
const pageFields = { page: z.enum(productPages), viewport: viewportSchema.optional() };
export const clientEventSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.enum(["page.view", "client.error", "client.rejection"]), ...pageFields }),
  z.strictObject({ name: z.literal("ui.action"), ...pageFields, action: z.enum(productActions) }),
  z.strictObject({ name: z.literal("page.engagement"), ...pageFields, durationMs: z.number().int().min(1000).max(3_600_000) }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;