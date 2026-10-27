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

// A whole country or a compass region ("North India") is not a place Meta can target as an area.
const COUNTRY_WIDE = /^(?:india|bharat|all india|pan[- ]india|nationwide|worldwide|global|(?:north|south|east|west|central|northern|southern|eastern|western|north[- ]?east|north[- ]?west)(?:ern)?\s+india)$/i;

/**
 * #1037: the service areas autofill proposes: at most 5, each written on the page itself (whole word,
 * any case), never a whole country. The owner confirms them as chips before anything is saved.
 */
export function verifiedAreas(areas: unknown, websiteText: string): string[] {
  if (!Array.isArray(areas)) return [];
  const text = websiteText.normalize("NFC");
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of areas) {
    if (typeof raw !== "string") continue;
    const area = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    const key = area.toLowerCase();
    if (!area || area.length > 60 || COUNTRY_WIDE.test(area) || seen.has(key)) continue;
    const escaped = area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    if (!new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text)) continue;
    seen.add(key);
    kept.push(area);
    if (kept.length === 5) break;
  }
  return kept;
}

/** The extraction call's settings, shared by the route and its fixture recorder (#650). */
export const BRAND_EXTRACTION = {
  routing: "budget",
  task: "website brand extraction",
  temperature: 0.3,
  maxTokens: 1_200,
  reasoningEffort: "minimal",
} as const satisfies CompletionOptions;
