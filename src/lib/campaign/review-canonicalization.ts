import type { ReviewDTO } from "./connect-contracts";
import type { ResolvedWhatsAppMessage } from "./whatsapp-template";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

export function reviewedMessage({ source, opening, language }: ResolvedWhatsAppMessage): NonNullable<ReviewDTO["whatsappMessage"]> {
  return {
    source, language, greeting: opening.greeting, autofill: opening.autofill,
    ...(opening.callButton ? { callButton: true } : {}),
    ...(opening.iceBreakers?.length ? { iceBreakers: opening.iceBreakers } : {}),
  };
}

/** #2452: whether the message launch rebuilt from fresh reads is the one this review checked; launch refuses otherwise. */
export function isReviewedWhatsAppMessage(message: ResolvedWhatsAppMessage, review: Pick<ReviewDTO, "whatsappMessage">): boolean {
  return Boolean(review.whatsappMessage)
    && JSON.stringify(canonicalize(reviewedMessage(message))) === JSON.stringify(canonicalize(review.whatsappMessage));
}
