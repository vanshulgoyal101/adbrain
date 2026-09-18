import type { BrandContext } from "@/lib/templates/ads";

export interface CreativeRecommendation {
  id: string;
  label: string;
  prompt: string;
}

function words(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

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
    if (offer.trim() && !current.toLowerCase().includes(offer.toLowerCase())) add("offer", `Feature: ${offer}`, `Feature this saved offer from ${brand.name}: ${offer.slice(0, 180)}. Do not add new terms.`, 6);
  }
  for (const benefit of (brand.usps ?? []).slice(0, 3)) {
    if (benefit.trim() && !current.toLowerCase().includes(benefit.toLowerCase())) add("benefit", `Lead with: ${benefit}`, `Build the hook around this saved business detail: ${benefit.slice(0, 180)}. Invite enquiries without adding claims.`, 5);
  }
  if (brand.target_audience?.trim() && !current.includes(brand.target_audience)) add("audience", `Reach ${brand.target_audience}`, `Address ${brand.target_audience.slice(0, 180)} using ${brand.name}'s saved services and facts.`, 4);
  for (const location of (brand.locations ?? []).slice(0, 2)) {
    if (location.trim() && !current.toLowerCase().includes(location.toLowerCase())) add("location", `Focus on ${location}`, `Focus the message on ${location.slice(0, 120)}, a saved service area for ${brand.name}.`, 3);
  }
  add("visual", current ? "Make the service the focus" : "Show our work", `Show ${brand.name}'s service in context, using only saved business details. No invented testimonials or results.`, 2);
  add("enquiry", "Invite enquiries", `Help interested customers ask ${brand.name} about the services in our Brand Brain and their next steps.`, 1);
  add("introduction", "Introduce my business", `Introduce ${brand.name} using our saved brand facts. Do not add an offer or unsupported claims.`, 0);
  const categories = new Set<string>();
  return candidates.sort((left, right) => right.score - left.score).filter((candidate) => {
    if (categories.has(candidate.category)) return false;
    categories.add(candidate.category);
    return true;
  }).slice(0, 3).map(({ id, label, prompt }) => ({ id, label, prompt }));
}

export function creativeFollowUps(): CreativeRecommendation[] {
  return [
    { id: "scene", label: "Explore another scene", direction: "Keep the confirmed message, but propose a different image composition. Preserve all factual constraints." },
    { id: "hook", label: "Try a different hook", direction: "Explore a different opening hook for the same goal. Keep the audience and confirmed offer unchanged." },
    { id: "tone", label: "Change the tone", direction: "Explore a different tone for this message. Ask which direction I prefer without repeating the earlier business questions." },
  ].map(({ id, label, direction }) => ({ id, label, prompt: direction }));
}