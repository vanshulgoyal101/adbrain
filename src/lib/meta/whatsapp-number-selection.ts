import { maskWhatsAppNumber, maskedWhatsAppNumberPattern, type WhatsAppNumberSource } from "./whatsapp-status-shared";
import { normalizeWhatsAppNumber } from "./whatsapp-numbers";

export async function resolveWhatsAppNumberCandidate(
  requested: string | null | undefined,
  source: WhatsAppNumberSource | undefined,
  pageRead: Promise<string | null>,
  businessRead: () => Promise<string[] | Error>,
): Promise<{ number: string; source: WhatsAppNumberSource } | null> {
  const masked = Boolean(requested && maskedWhatsAppNumberPattern.test(requested));
  const wanted = requested && !masked ? normalizeWhatsAppNumber(requested) : null;
  if (!requested || source === "page" || (!masked && source !== "business")) {
    const page = await pageRead;
    if (!requested) return page ? { number: page, source: "page" } : null;
    if (!masked && !wanted) return null;
    if (source !== "business" && page && (masked ? maskWhatsAppNumber(page) === requested : page === wanted)) {
      return { number: page, source: "page" };
    }
    if (source === "page") return null;
  }
  // Unknown legacy masks must be unique across all WABAs, not just already-bound numbers.
  const [pageResult, businessResult] = await Promise.allSettled([pageRead, businessRead()]);
  if (businessResult.status === "rejected") throw businessResult.reason;
  const business = businessResult.value;
  if (business instanceof Error) throw business;
  if (pageResult.status === "rejected") {
    if (!business.length) throw pageResult.reason;
    if (source !== "business") return null;
  }
  const page = pageResult.status === "fulfilled" ? pageResult.value : null;
  const matches = [
    ...(source !== "business" && page ? [{ number: page, source: "page" as const }] : []),
    ...business.filter((number) => source === "business" || number !== page).map((number) => ({ number, source: "business" as const })),
  ].filter(({ number }) => masked ? maskWhatsAppNumber(number) === requested : number === wanted);
  return matches.length === 1 ? matches[0] : null;
}
