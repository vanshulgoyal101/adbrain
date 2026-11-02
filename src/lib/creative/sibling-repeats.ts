type Copy = { headline: string; primary_text: string };

const normalizeCopy = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const opening = (text: string) => normalizeCopy(text).split(" ").slice(0, 8).join(" ");
const quotedOpening = (text: string) => text.split(/\s+/).slice(0, 8).join(" ");

// One per distinct normalized text, in recency order, so the repair's avoid list doesn't repeat itself.
function distinct<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
}

const others = (texts: string[]) => (texts.length ? `; also avoid ${texts.map((text) => `"${text}"`).join(", ")}` : "");

/**
 * #1035/#2444: a headline or opening that repeats a recent ad's (siblings first) is one issue per rule. It quotes
 * the ad it repeats and lists the other recent ones: told only the one it hit, a targeted repair could write a
 * sibling's line instead, and in the parallel schedule the siblings weren't in its first prompt.
 */
export function repeatIssues(copy: Copy, recent: Copy[]): string[] {
  const issues: string[] = [];
  const headlines = distinct(recent.map((item) => item.headline), normalizeCopy);
  const hit = headlines.find((headline) => normalizeCopy(headline) === normalizeCopy(copy.headline));
  if (hit !== undefined) {
    const rest = headlines.filter((headline) => headline !== hit).map((headline) => headline.slice(0, 60));
    issues.push(`repeated-headline: "${hit.slice(0, 60)}" is a recent ad's headline; write a different one${others(rest)}`);
  }
  // #1035: quoting the opening lets the one repair avoid it; "write a different hook" alone repeated it (Oct 27).
  const openings = distinct(recent.map((item) => item.primary_text), opening);
  const opened = openings.find((text) => opening(text) === opening(copy.primary_text));
  if (opened !== undefined) {
    const rest = openings.filter((text) => text !== opened).map(quotedOpening);
    issues.push(`repeated-opening: a recent ad opens "${quotedOpening(opened)}"; start primary_text with different words${others(rest)}`);
  }
  return issues;
}
