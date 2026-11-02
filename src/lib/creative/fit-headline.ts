import { shortenHeadline } from "./design";

const TRAILING_CTA = /(?<=[.!?।])\s+(?:learn more|book now|message us(?: to learn more)?|(?:पूरी|अधिक) जानकारी के लिए संपर्क करें)[.!?।]?$/iu;
const TRAILING_QUALIFIER = /(?:,\s+|\s+[-–—]\s+)(?:made simple|with confidence|without the hassle)[.!?]?$/iu;
const UNFINISHED = /(?:^|\s)(?:a|an|the|your|our|and|or|but|for|in|to|with|without|is|are|that|of|at|by|on|as|from|into|about|over|under|before|after|than|if|unless|until|because|not|से|में|और|या|लिए|के|की|का|को|पर|तक|बिना|साथ|कि)[.!?।]*$/iu;

/**
 * Remove only recognized trailing boilerplate, never arbitrary words or facts.
 * Null means the caller must keep the original headline for validation/repair.
 */
export function fitHeadline(text: string, max = 40): string | null {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("Headline cap must be a positive integer");
  if (!text.trim()) return null;
  if (text.length <= max) return text;
  let candidate = text.trim();
  while (candidate.length > max) {
    const withoutCta = candidate.replace(TRAILING_CTA, "");
    const shorter = withoutCta === candidate ? candidate.replace(TRAILING_QUALIFIER, "") : withoutCta;
    if (!shorter || shorter === candidate || UNFINISHED.test(shorter)) return null;
    candidate = shorter;
  }
  // The shared renderer helper must not shorten a word, strip emoji or rewrite this thought.
  return shortenHeadline(candidate, max) === candidate ? candidate : null;
}
