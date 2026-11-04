import { createHmac } from "node:crypto";
import type { WhatsAppNumberSource } from "@/lib/types/campaign";

/** Identifies a choice without revealing its number or allowing it to be reused by another business. */
export function whatsappChoiceId(businessId: string, source: WhatsAppNumberSource, number: string): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret?.trim()) throw new Error("WhatsApp choice verification is not configured.");
  return createHmac("sha256", secret).update(`whatsapp-choice:v1\0${businessId}\0${source}\0${number}`).digest("hex");
}
