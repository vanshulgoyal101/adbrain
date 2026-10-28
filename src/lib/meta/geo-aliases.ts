/**
 * #1555: everyday area names Meta's place search doesn't know, as the places it does.
 * 'Tricity' (Chandigarh–Mohali–Panchkula) otherwise only matches Tri-City, Oregon.
 */
const ALIASES: Record<string, string[]> = {
  tricity: ["Chandigarh", "Mohali", "Panchkula"],
};

const aliasKey = (name: string) => name.trim().toLowerCase().replace(/[\s.-]+/g, "");

/** The names to search for: each alias becomes its places, in order, without repeats. */
export function expandPlaceAliases(names: string[]): string[] {
  const out = names.flatMap((name) => ALIASES[aliasKey(name ?? "")] ?? [name]);
  return out.filter((name, index) => out.findIndex((other) => aliasKey(other ?? "") === aliasKey(name ?? "")) === index);
}
