/**
 * Public compliance pages, linked from every footer (marketing, legal, and the
 * signed-in app shell). Meta app review requires the data-deletion instructions
 * to be reachable, so this stays the single source of truth for those links.
 */
export const LEGAL_LINKS: { href: string; label: string }[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-deletion", label: "Data deletion" },
];
