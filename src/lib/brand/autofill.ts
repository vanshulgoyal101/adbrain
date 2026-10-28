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

const GENERIC_TITLE = /^(?:home(?:\s*page)?|welcome|index|official (?:site|website)|untitled)$/i;
const tidyName = (raw: string) => raw.normalize("NFC").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ").replace(/\s+/g, " ").trim();
const nameLike = (name: string) => name.length >= 2 && name.length <= 60 && name.split(" ").length <= 6 && /\p{L}/u.test(name);

/**
 * #1379: the business name from the page itself, not the model: `og:site_name`, then `application-name`, then the
 * first part of the title that isn't a generic word ("Home | Solaride" → "Solaride"). Undefined when none fits.
 */
export function extractSiteName(html: string): string | undefined {
  const root = parse(html);
  const candidates = [
    root.querySelector('meta[property="og:site_name"]')?.getAttribute("content"),
    root.querySelector('meta[name="application-name"]')?.getAttribute("content"),
    ...(root.querySelector("title")?.text ?? "").split(/\s+[|\u2013\u2014\u00b7:-]\s+|\s*[|\u00b7]\s*/),
  ];
  for (const raw of candidates) {
    const name = tidyName(raw ?? "");
    if (nameLike(name) && !GENERIC_TITLE.test(name)) return name;
  }
}

/**
 * #1379: the name a pasted bio or listing starts with, up to the first emoji, bar, bullet, comma, colon or line break
 * ("Sweet Crumbs Bakery 🍰 Mohali Phase 7 | Eggless cakes" → "Sweet Crumbs Bakery"). Undefined when it doesn't read like a name.
 */
export function nameInText(text: string): string | undefined {
  const lead = text.normalize("NFC").trim().split(/[\p{Extended_Pictographic}|\u00b7\u2022,:\n]|\s[\u2013\u2014-]\s/u)[0] ?? "";
  const name = tidyName(lead);
  return nameLike(name) && !GENERIC_TITLE.test(name) ? name : undefined;
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

/** #1317: what a prospect without a website pastes (an Instagram bio, a Google listing, a catalogue blurb). */
export const PASTED_TEXT_MAX = 6000;
const PASTED_MIN_LETTERS = 30;

/** Pasted text as autofill reads it: whitespace collapsed, at most PASTED_TEXT_MAX characters, or null when too short to describe a business. */
export function pastedBrandText(raw: string): string | null {
  const text = raw.normalize("NFC").replace(/[\t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, PASTED_TEXT_MAX);
  return (text.match(/[\p{L}\p{M}]/gu)?.length ?? 0) >= PASTED_MIN_LETTERS ? text : null;
}

/** A phone number written in pasted text ("+91 98765 43210", "98765-43210", "wa.me/919876543210"), as +<country><number>. */
export function phoneInText(text: string): string | undefined {
  for (const match of text.matchAll(/(?:wa\.me\/|\+)?\d[\d\s-]{8,16}\d/g)) {
    let digits = match[0].replace(/^wa\.me\//, "+").replace(/[\s-]/g, "");
    if (!digits.startsWith("+")) {
      const local = digits.replace(/^0/, "");
      if (/^[6-9]\d{9}$/.test(local)) digits = `+91${local}`;
      else if (/^91[6-9]\d{9}$/.test(digits)) digits = `+${digits}`;
      else continue;
    }
    if (isValidPhone(digits)) return digits;
  }
  return undefined;
}
