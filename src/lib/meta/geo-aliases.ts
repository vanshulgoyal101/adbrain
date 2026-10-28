/**
 * #1555, #1556: everyday area names Meta's place search doesn't know, as the places it does
 * (recorded: tests/core/fixtures/meta/geo-pilot.json). 'Tricity' otherwise only matches
 * Tri-City, Oregon; Zirakpur, New Chandigarh and Aerocity have no Meta place; Meta spells
 * Derabassi 'Dera Bassi'.
 */
const TRICITY = ["Chandigarh", "Mohali", "Panchkula"];
const ALIASES: Record<string, string[]> = {
  tricity: TRICITY,
  // Zirakpur borders all three (Meta matches only its PIN, 140603); the owner sees the three names.
  zirakpur: TRICITY,
  derabassi: ["Dera Bassi"],
  newchandigarh: ["Mohali"],
  aerocity: ["Mohali"],
  aerocitymohali: ["Mohali"],
};

const aliasKey = (name: string) => name.trim().toLowerCase().replace(/[\s.,-]+/g, "");
// "Sector 34 Chandigarh", "Mohali Phase 3B2", "Panchkula Sec 20": the city is what Meta knows.
const SECTOR = /\b(?:sector|sec|phase|ph)\.?\s*\d+[a-z0-9]*\b/gi;

function expandOne(raw: string): string[] {
  const name = raw ?? "";
  const stripped = name.replace(SECTOR, " ");
  const city = stripped === name ? "" : stripped.replace(/[\s,]+/g, " ").trim();
  const place = city || name;
  return ALIASES[aliasKey(place)] ?? [place];
}

/** The names to search for: each alias becomes its places, in order, without repeats. */
export function expandPlaceAliases(names: string[]): string[] {
  const out = names.flatMap(expandOne);
  return out.filter((name, index) => out.findIndex((other) => aliasKey(other ?? "") === aliasKey(name ?? "")) === index);
}
