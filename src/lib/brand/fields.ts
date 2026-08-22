/**
 * Pure parsers for the brand form's text fields. Extracted from the server
 * action so they can be unit-tested (a `"use server"` module may only export
 * async actions).
 */

/** Trim a form value, returning `null` when it's empty. */
export function fieldStr(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length ? s : null;
}

/**
 * Split a form value into a trimmed, de-blanked list.
 *
 * `sep` defaults to comma-or-newline for comma-separated fields (languages,
 * locations). One-per-line fields (USPs, offers) must pass `/\n/` so that a
 * value like "Affordable, transparent pricing" stays a single entry instead of
 * being split on its comma.
 */
export function fieldList(
  value: FormDataEntryValue | null,
  sep: RegExp = /[\n,]/,
): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}
