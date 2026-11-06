import { z } from "zod";
import { collectLeadPages, parseLeadPage } from "./lead-pages";

const phone = z.object({ display_phone_number: z.string() });
const account = z.object({
  id: z.string().regex(/^\d{1,64}$/).optional(),
  phone_numbers: z.record(z.string(), z.unknown()),
});

const MAX_REQUESTS = 20;
const MAX_NUMBERS = 10_000;

function whatsappPage<T>(value: unknown, schema: z.ZodType<T>, previous?: string | null) {
  const paging = z.object({ paging: z.object({ next: z.string().min(1).optional() }).optional() }).safeParse(value);
  if (!paging.success) throw new Error("WhatsApp Business numbers could not be read completely.");
  return parseLeadPage(value, schema, previous);
}

export function normalizeWhatsAppNumber(value: string): string | null {
  const number = value.replace(/[\s().-]/g, "").replace(/^\+?/, "+");
  return /^\+[1-9]\d{6,14}$/.test(number) ? number : null;
}

export async function readBusinessWhatsAppNumbers(businessId: string, graph: (path: string) => Promise<unknown>): Promise<string[]> {
  let requests = 0;
  const read = (path: string) => {
    if (++requests > MAX_REQUESTS) throw new Error("WhatsApp Business number page limit exceeded.");
    return graph(path);
  };
  const accounts = await collectLeadPages(async (after) => {
    const params = new URLSearchParams({ fields: "phone_numbers{display_phone_number}", limit: "100" });
    if (after) params.set("after", after);
    return whatsappPage(await read(`${businessId}/owned_whatsapp_business_accounts?${params}`), account, after);
  });
  const numbers = new Set<string>();
  for (const waba of accounts) {
    const first = whatsappPage(waba.phone_numbers, phone);
    if (first.after && !waba.id) throw new Error("WhatsApp Business account could not be paged.");
    const phones = await collectLeadPages(async (after) => {
      if (!after) return first;
      const params = new URLSearchParams({ fields: "display_phone_number", limit: "100", after });
      return whatsappPage(await read(`${waba.id}/phone_numbers?${params}`), phone, after);
    });
    for (const entry of phones) {
      const number = normalizeWhatsAppNumber(entry.display_phone_number);
      if (!number) throw new Error("WhatsApp Business numbers could not be read completely.");
      numbers.add(number);
      if (numbers.size > MAX_NUMBERS) throw new Error("WhatsApp Business number limit exceeded.");
    }
  }
  return [...numbers];
}
