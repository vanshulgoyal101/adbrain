/**
 * #763 (CPO's first-time-owner walk): the words owners see, in one place. Internal names (Brand Brain,
 * USPs, tracked campaign) stay out of the UI; prompts and code may keep them.
 */
export const OWNER_WORDS = {
  /** The Brand page and everything that sends owners there. Was "Brand Brain". */
  business: "Your business",
  /** Brand form field. Was "USPs". */
  usps: "Why customers choose you",
  /** Brand form field. Was "Logo URL". */
  logoUrl: "Logo link",
  /** Brand page panel eyebrow. Was "Live context check". */
  preview: "Preview",
} as const;
