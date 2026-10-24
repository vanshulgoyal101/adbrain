/**
 * Shared validators for brand-form inputs. Pure so the client can show inline
 * errors and the server action can reject the same values — the browser's
 * native validation is a convenience, not a guarantee.
 */

/** Deliberately permissive: one @, no spaces, a dot-separated domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(raw: string): boolean {
  const value = raw.trim();
  return value.length > 0 && value.length <= 254 && EMAIL_RE.test(value);
}

/** Accept only absolute http(s) URLs — anything else can't be fetched or shown. */
export function isValidHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Digits, with optional +, spaces, dashes, brackets. Length-checked on digits. */
export function isValidPhone(raw: string): boolean {
  const value = raw.trim();
  if (!/^\+?[\d\s()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * The website as a full link: owners type it bare ("solaride.in", "www.solaride.in/solar"), Meta
 * and the preflight need "https://…" (#470). Null for empty input, garbage and non-web schemes.
 */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || /\s/.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return isValidHttpUrl(value) ? value : null;
  // "javascript:", "mailto:" or "ftp://" are not websites; "vanshul.com:8080" is a port.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null;
  const url = `https://${value}`;
  return isValidHttpUrl(url) && /\.[a-z]{2,}$/i.test(new URL(url).hostname) ? url : null;
}

/** A domain as well as a full URL is a valid website; it is stored normalised. */
export function isValidWebsite(raw: string): boolean {
  return normalizeWebsite(raw) !== null;
}

export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * Validate the optional contact/link fields. Empty is always allowed — these
 * only fire when the user actually typed something.
 */
export function validateBrandFields(values: {
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  phone?: string | null;
}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const email = (values.email ?? "").trim();
  if (email && !isValidEmail(email)) {
    issues.push({ field: "email", message: "Enter a valid email address." });
  }
  const website = (values.website ?? "").trim();
  if (website && !isValidWebsite(website)) {
    issues.push({
      field: "website",
      message: "Enter a valid website, like yourbusiness.com",
    });
  }
  const logo = (values.logo_url ?? "").trim();
  if (logo && !isValidHttpUrl(logo)) {
    issues.push({
      field: "logo_url",
      message: "Enter a full logo URL starting with https://",
    });
  }
  const phone = (values.phone ?? "").trim();
  if (phone && !isValidPhone(phone)) {
    issues.push({ field: "phone", message: "Enter a valid phone number." });
  }
  return issues;
}
