/**
 * #760 (CPO walk): an ad image of an empty waiting room or a bare roof shows nothing to want. A cheap,
 * deterministic check on the concept's visual direction before any image is paid for.
 */

const EMPTY_SCENE = /\b(?:empty|unoccupied|deserted|vacant|bare)\b|\b(?:reception|waiting)\s+(?:area|room)\b/i;
const SUBJECT = /\b(?:person|people|patients?|clients?|customers?|owners?|team|staff|chiropractors?|dentists?|doctors?|therapists?|technicians?|engineers?|installers?|workers?|family|families|man|men|woman|women|child(?:ren)?|kids?|couple|hands?|homeowners?|farmers?|panels?|array|installation|product)\b/i;
// Space kept clear for copy, and "no people" exclusions, aren't the scene.
const COPY_SPACE = /\b(?:copy|overlay|text|headline|negative space)\b/i;
const NO_PEOPLE = /\b(?:no|without)\s+(?:visible\s+)?(?:people|persons?|staff|faces?)\b/gi;

/** The empty-scene word when a visual direction has no person, team or product to look at; else null. */
export function emptyScene(direction: string): string | null {
  const scene = direction.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => !COPY_SPACE.test(sentence)).join(" ").replace(NO_PEOPLE, "");
  const empty = EMPTY_SCENE.exec(scene)?.[0];
  return empty && !SUBJECT.test(scene) ? empty : null;
}
