import { z } from "zod";
import { getCountry, parsePhone } from "@/lib/brand/countries";
import type { WhatsAppNumberChoice } from "@/lib/types/campaign";

/** A WhatsApp number as the browser sees it: masked, never in full (#235 QA). */
export type { WhatsAppNumberChoice, WhatsAppNumberSource } from "@/lib/types/campaign";

export type WhatsAppStatus =
  | { state: "ready"; numbers: WhatsAppNumberChoice[]; businessUnavailable?: true }
  | { state: "not_linked" }
  | { state: "unavailable" };

/** "+91 ••••• 4842". A draft may name its WhatsApp button number this way; the server resolves it. */
export const maskedWhatsAppNumberPattern = /^\+[1-9]\d{0,3} ••••• \d{4}$/;

const whatsappStatusSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    numbers: z.array(z.object({
      masked: z.string().regex(maskedWhatsAppNumberPattern),
      source: z.enum(["page", "business"]),
      choiceId: z.string().regex(/^[a-f0-9]{64}$/),
    })).min(1)
      .refine((numbers) => new Set(numbers.map(({ masked, source }) => `${source}:${masked}`)).size === numbers.length)
      .refine((numbers) => new Set(numbers.map(({ choiceId }) => choiceId)).size === numbers.length),
    businessUnavailable: z.literal(true).optional(),
  }),
  z.object({ state: z.literal("not_linked") }),
  z.object({ state: z.literal("unavailable") }),
]);

/** A `GET /api/meta/whatsapp` body; anything unexpected reads as unavailable. */
export function parseWhatsAppStatus(data: unknown): WhatsAppStatus {
  return whatsappStatusSchema.safeParse(data).data ?? { state: "unavailable" };
}

/** "+91 ••••• 0874" from "+919999990874": the dialling code and last four digits. */
export function maskWhatsAppNumber(number: string): string {
  const dial = getCountry(parsePhone(number).countryCode).dial;
  return `+${number.startsWith(`+${dial}`) ? dial : number.slice(1, 3)} ••••• ${number.slice(-4)}`;
}
