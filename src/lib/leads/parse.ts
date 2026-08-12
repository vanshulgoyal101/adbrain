/**
 * Normalize a Meta instant-form lead's `field_data` into predictable fields.
 * Meta returns an array of { name, values[] } where field names vary by form
 * (full_name, first_name, phone_number, email, city, …), so we match loosely.
 */

export interface MetaFieldDatum {
  name: string;
  values: string[];
}

export interface ParsedLead {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  fields: Record<string, string>;
}

function normalizePhone(value: string): string {
  // Keep a leading + and digits; collapse the rest.
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

export function parseLeadFields(fieldData: MetaFieldDatum[] | null | undefined): ParsedLead {
  const fields: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    const key = (f?.name ?? "").trim().toLowerCase();
    if (!key) continue;
    const val = Array.isArray(f?.values)
      ? f.values.map((v) => `${v}`.trim()).filter(Boolean).join(", ")
      : "";
    fields[key] = val;
  }

  const pick = (...needles: string[]): string | null => {
    for (const needle of needles) {
      const entry = Object.entries(fields).find(
        ([name, value]) => name.includes(needle) && value,
      );
      if (entry) return entry[1];
    }
    return null;
  };

  const first = pick("first_name");
  const last = pick("last_name");
  const combined =
    first && last ? `${first} ${last}` : first || last || null;

  const phone = pick("phone", "mobile", "contact", "whatsapp");
  const email = pick("email");
  const city = pick("city", "town", "location");

  return {
    fullName: pick("full_name") ?? combined ?? pick("name"),
    phone: phone ? normalizePhone(phone) : null,
    email: email ? email.toLowerCase() : null,
    city,
    fields,
  };
}
