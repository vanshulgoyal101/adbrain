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

const PERSON = /\b(?:owner|doctor|dentist|chiropractor|therapist|technician|installer|engineer|electrician|crew|team|staff|customer|client|patient|homeowner|couple|woman|man|men|women|adult|person|people|worker|stylist|teacher|student|bride|parent|child|hands?)\b/i;

/**
 * #418 rule 4: whether the visual direction puts a person in the picture. Sentences starting with
 * avoid/no/without and "no …"/"free of …" spans are dropped, so "no people" doesn't count.
 */
export function personInScene(direction: string): boolean {
  return direction.split(/(?<=[.;!?])\s+/)
    .filter((sentence) => !/^(?:avoid|do not|don't|no|without|exclude|omit|never)\b/i.test(sentence.trim()))
    .map((sentence) => sentence.replace(/\b(?:no|without|free of|devoid of|never)\b[^.;,]*/gi, ""))
    .some((sentence) => PERSON.test(sentence));
}

const NO_PEOPLE_WANTED = /\b(?:no|without|avoid|don'?t (?:show|use|add)|never (?:show|use))\s+(?:any\s+)?(?:people|persons?|humans?|faces?|models?|staff|customers?)\b|\b(?:just|only)\s+(?:the\s+|our\s+)?(?:shop|store|product|products|panels?|building|premises|food|dish(?:es)?)\b|\bproduct[- ]only\b/i;

/**
 * #418 rule 4 (Analyst, #941): long-running local ads show a person or real work, not an empty product
 * shot. When the concept's picture has no one in it, the image prompt opens with one, at $0 and with no
 * repair. It goes first and names the business's work: the free image model reads only about the first
 * 77 tokens, so a line at the end was ignored (Dev 2, #1076). The owner's own "no people" wins.
 */
export function personSubjectLine(
  direction: string,
  ownerWords: (string | null | undefined)[] = [],
  business: { name?: string | null; vertical?: string | null } = {},
): string | null {
  if (personInScene(direction) || ownerWords.some((words) => words && NO_PEOPLE_WANTED.test(words))) return null;
  const who = [business.name?.trim(), business.vertical?.trim()].filter(Boolean).join(" ").slice(0, 80);
  return `Main subject, overriding any "no people" note: a ${who ? `${who} ` : ""}professional at work with a customer, mid-task and natural, not posed; never an empty or product-only shot.`;
}
