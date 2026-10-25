import { parse } from "node-html-parser";
import { isValidPhone } from "@/lib/brand/validation";
import type { CompletionOptions } from "@/lib/llm/types";

/** The website text Brand autofill sends to the model: title, meta description and body, no code. */
export function extractWebsiteText(html: string): string {
  const root = parse(html);
  root
    .querySelectorAll("script, style, noscript, svg")
    .forEach((n) => n.remove());
  const title = root.querySelector("title")?.text ?? "";
  const metaDesc =
    root.querySelector('meta[name="description"]')?.getAttribute("content") ??
    "";
  const body = root.querySelector("body")?.text ?? root.text;
  return `${title}\n${metaDesc}\n${body}`.replace(/\s+/g, " ").trim();
}

/** First international-format tel: link; national numbers are skipped because the country is unknown. */
export function extractPhone(html: string): string | undefined {
  for (const link of parse(html).querySelectorAll('a[href^="tel:"]')) {
    let phone: string;
    try {
      phone = decodeURIComponent(link.getAttribute("href")!.slice(4)).replace(/[.\u00a0]/g, " ").trim();
    } catch {
      continue;
    }
    if (phone.startsWith("+") && isValidPhone(phone)) return phone;
  }
}

/** The extraction call's settings, shared by the route and its fixture recorder (#650). */
export const BRAND_EXTRACTION = {
  routing: "budget",
  task: "website brand extraction",
  temperature: 0.3,
  maxTokens: 1_200,
  reasoningEffort: "minimal",
} as const satisfies CompletionOptions;
