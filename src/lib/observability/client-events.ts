import { z } from "zod";

export const productPages = ["/dashboard", "/brand", "/create", "/studio", "/campaigns", "/leads", "/assets", "/settings"] as const;
export const productActions = ["creative.generate", "creative.regenerate", "creative.edit", "creative.inspect", "creative.approve", "creative.unapprove", "creative.download", "creative.share",
  "campaign.create", "campaign.share_results", "campaign.review", "campaign.activate", "campaign.pause", "campaign.edit_audience", "campaign.edit_ad", "campaign.edit_budget", "campaign.sync", "brand.save", "asset.upload", "asset.delete",
  "lead.follow_up", "lead.customer", "payment.checkout", "payment.quote", "meta.connect", "meta.access_request",
  // #1284: an owner asking a person for help (Help on WhatsApp) counts toward "owners needing help".
  "help.whatsapp"] as const;
/** #1242: the Create → Review → Launch path, where every tap counts toward #1226's "≤ 12 taps to live". */
export const tapPages = ["/create", "/studio", "/campaigns"] as const satisfies readonly (typeof productPages)[number][];
export const viewportSchema = z.enum(["compact", "medium", "wide"]);
const pageFields = { page: z.enum(productPages), viewport: viewportSchema.optional() };
export const clientEventSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.enum(["page.view", "client.error", "client.rejection"]), ...pageFields }),
  z.strictObject({ name: z.literal("ui.action"), ...pageFields, action: z.enum(productActions) }),
  // #1242: one per tap on a control on the launch path; the page only, never what was tapped or typed.
  z.strictObject({ name: z.literal("ui.tap"), page: z.enum(tapPages), viewport: viewportSchema.optional() }),
  z.strictObject({ name: z.literal("page.engagement"), ...pageFields, durationMs: z.number().int().min(1000).max(3_600_000) }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;