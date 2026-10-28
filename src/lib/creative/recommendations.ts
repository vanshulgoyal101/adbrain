import type { BrandContext } from "@/lib/templates/ads";

export interface CreativeRecommendation {
  id: string;
  label: string;
  prompt: string;
}

function words(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/**
 * Starting goals the owner taps into their goal box, in their own plain words (#1153: not instructions for
 * the model). The "only supplied facts, no new terms" guard lives server-side, in the concept prompt and
 * its claim check, so a tapped goal can't add a claim either way.
 */
export function creativeRecommendations(brand: BrandContext, goal = "", recentGoals: string[] = []): CreativeRecommendation[] {
  const current = goal.trim();
  const candidates: (CreativeRecommendation & { category: string; score: number })[] = [];
  const add = (category: string, label: string, direction: string, score: number) => {
    const prompt = current ? `${current.slice(0, 320)}\n\n${direction}` : direction;
    const terms = words(direction);
    const relevance = [...words(current)].filter((word) => terms.has(word)).length;
    const repetition = recentGoals.reduce((total, previous) => total + [...words(previous)].filter((word) => terms.has(word)).length, 0);
    candidates.push({ id: `${category}-${candidates.length}`, category, label: label.slice(0, 100), prompt: prompt.slice(0, 500), score: score + relevance * 2 - repetition });
  };
  for (const offer of (brand.offers ?? []).slice(0, 3)) {
    if (offer.trim() && !current.toLowerCase().includes(offer.toLowerCase())) add("offer", `Feature: ${offer}`, `Promote our ${offer.slice(0, 180).replace(/[.!\s]+$/, "")}.`, 6);
  }
  for (const benefit of (brand.usps ?? []).slice(0, 3)) {
    if (benefit.trim() && !current.toLowerCase().includes(benefit.toLowerCase())) add("benefit", `Lead with: ${benefit}`, `Lead with: ${benefit.slice(0, 180).replace(/[.!\s]+$/, "")}.`, 5);
  }
  if (brand.target_audience?.trim() && !current.includes(brand.target_audience)) add("audience", `Reach ${brand.target_audience}`, `Reach ${brand.target_audience.slice(0, 180).replace(/[.!\s]+$/, "")}.`, 4);
  for (const location of (brand.locations ?? []).slice(0, 2)) {
    if (location.trim() && !current.toLowerCase().includes(location.toLowerCase())) add("location", `Focus on ${location}`, `Get more customers in ${location.slice(0, 120)}.`, 3);
  }
  add("visual", current ? "Make the service the focus" : "Show our work", `Show our work and the people we help.`, 2);
  add("enquiry", "Invite enquiries", `Get people to message us about our services.`, 1);
  add("introduction", "Introduce my business", `Introduce ${brand.name} to new customers.`, 0);
  const categories = new Set<string>();
  return candidates.sort((left, right) => right.score - left.score).filter((candidate) => {
    if (categories.has(candidate.category)) return false;
    categories.add(candidate.category);
    return true;
  }).slice(0, 3).map(({ id, label, prompt }) => ({ id, label, prompt }));
}

export function creativeFollowUps(): CreativeRecommendation[] {
  return [
    // #1153: these fill the goal box too, so they are the owner's words; the brief and claim check keep the facts.
    { id: "scene", label: "Explore another scene", direction: "Same message, with a different picture." },
    { id: "hook", label: "Try a different hook", direction: "Same goal and offer, with a different opening line." },
    { id: "tone", label: "Change the tone", direction: "Same message in a different tone. Ask me which tone I'd like." },
  ].map(({ id, label, direction }) => ({ id, label, prompt: direction }));
}
/**
 * #858: the Brand already answers what the interview would ask (an offer or proof point, an area, a
 * phone), so a suggestion chip's brief can go straight to Generate.
 */
export function hasCreateFacts(brand: Pick<BrandContext, "offers" | "usps" | "locations" | "phone">): boolean {
  const any = (values?: string[] | null) => (values ?? []).some((value) => value.trim());
  return (any(brand.offers) || any(brand.usps)) && any(brand.locations) && Boolean(brand.phone?.trim());
}
