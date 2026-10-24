import ads from "./ads.json";
import { IDEA_BUSINESSES, type IdeaBusiness } from "./businesses";
import type { IdeaAd } from "./types";

export type Idea = IdeaBusiness & { ads: IdeaAd[] };

/** Businesses that have generated ads, in gallery order. */
export const IDEAS: Idea[] = IDEA_BUSINESSES
  .map((business) => ({ ...business, ads: (ads as Record<string, IdeaAd[]>)[business.slug] ?? [] }))
  .filter((idea) => idea.ads.length > 0);

export const findIdea = (slug: string) => IDEAS.find((idea) => idea.slug === slug);

