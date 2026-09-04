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
 * Websites may be typed bare ("solaride.in") — `hostFromUrl` prepends the
 * scheme — so accept a domain as well as a full URL.
 */
export function isValidWebsite(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return isValidHttpUrl(value);
  if (/\s/.test(value)) return false;
  return isValidHttpUrl(`https://${value}`) && /\.[a-z]{2,}/i.test(value);
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
