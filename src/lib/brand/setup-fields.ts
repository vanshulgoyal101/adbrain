/**
 * #1269 (#1251 WS1 step 1): the five things a first-timer gives, exactly what `brandUsable` (#1136) needs.
 * Pure, so the step and its save action check the same rules. Words: the CPO's #1251 strings.
 */
export type SetupBusinessFields = {
  name: string;
  /** "What you sell": stored as the business's category (`vertical`). */
  vertical: string;
  /** One place per line; commas are content ("Malviya Nagar, Jaipur"), as on the full Brand form. */
  locations: string;
  offer: string;
  phone: string;
  usp?: string;
};

export type SetupField = keyof SetupBusinessFields;

/** #1966: the fill-in-the-blanks lines for "Why do customers pick you?" (`setup.business.proof.chips`), by segment. */
export const PROOF_CHIPS = {
  solar: ["solarTeam", "solarHomes"],
  ielts: ["ieltsSize", "ieltsMock", "ieltsEvening"],
  interiors: ["interiorsDesign", "interiorsWorkshop", "interiorsKitchens"],
} as const;
export const SETUP_FIELDS: Exclude<SetupField, "usp">[] = ["name", "vertical", "locations", "offer", "phone"];

export const SETUP_FIELD_LIMITS: Record<Exclude<SetupField, "usp">, number> = { name: 120, vertical: 120, locations: 600, offer: 200, phone: 20 };

export function setupLocations(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** A 10-digit Indian mobile, with or without +91 / 0 and spaces; null otherwise. */
export function setupPhone(value: string): string | null {
  if (!/^\+?[\d\s()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0") ? digits.slice(1)
    : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

export function setupFieldErrors(fields: SetupBusinessFields): Partial<Record<SetupField, string>> {
  const errors: Partial<Record<SetupField, string>> = {};
  if (!fields.name.trim()) errors.name = "Add your business name.";
  if (!fields.vertical.trim()) errors.vertical = "Say what you sell, in a few words.";
  if (!setupLocations(fields.locations).length) errors.locations = "Add at least one city or area.";
  if (!fields.offer.trim()) errors.offer = "Add one offer, like a free visit or a first-time price.";
  if (!setupPhone(fields.phone)) errors.phone = "Enter a 10-digit mobile number.";
  if (/[{}]/.test(fields.usp ?? "")) errors.usp = "Fill in each blank, using only what is true for your business.";
  return errors;
}

export function setupFieldsFrom(business: {
  name?: string | null; vertical?: string | null; locations?: readonly string[] | null;
  offers?: readonly string[] | null; phone?: string | null;
  usps?: readonly string[] | null;
} | null): SetupBusinessFields {
  return {
    name: business?.name ?? "",
    // The column's default, not something the owner said.
    vertical: business?.vertical && business.vertical !== "local business" ? business.vertical : "",
    locations: (business?.locations ?? []).join("\n"),
    offer: business?.offers?.[0] ?? "",
    phone: business?.phone ?? "",
    usp: business?.usps?.[0] ?? "",
  };
}
