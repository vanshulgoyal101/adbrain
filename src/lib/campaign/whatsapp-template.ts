import { z } from "zod";
import type { WhatsAppOpening } from "@/lib/meta/client";
import { ICE_BREAKER_LIMITS } from "@/lib/meta/limits";

/**
 * #840: a business's saved WhatsApp opening (`businesses.whatsapp_template`). New WhatsApp
 * campaigns start from it; null keeps AdBrain's per-campaign greeting and prefill.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
export const whatsappTemplateSchema = z.object({
  greeting: text(300),
  opening: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("prefill"), prefill: text(300), callButton: z.boolean().default(false) }),
    z.object({
      kind: z.literal("ice_breakers"),
      questions: z.array(z.string().trim().min(1).refine((title) => [...title].length <= ICE_BREAKER_LIMITS.chars, `Up to ${ICE_BREAKER_LIMITS.chars} characters`))
        .min(1).max(ICE_BREAKER_LIMITS.count)
        .refine((titles) => new Set(titles).size === titles.length, "Use different questions"),
    }),
  ]),
  language: z.enum(["en", "hi", "hinglish", "pa"]).default("en"),
});
export type WhatsAppTemplate = z.infer<typeof whatsappTemplateSchema>;

/** The stored template as an opening, or null when there is none or it no longer validates. */
export function templateOpening(stored: unknown): WhatsAppOpening | null {
  const parsed = whatsappTemplateSchema.safeParse(stored);
  if (!parsed.success) return null;
  const { greeting, opening } = parsed.data;
  return opening.kind === "prefill"
    ? { greeting, autofill: opening.prefill, callButton: opening.callButton }
    : { greeting, autofill: "", iceBreakers: opening.questions };
}
