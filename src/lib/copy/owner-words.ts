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
  /** A campaign whose stored status is active; Meta still decides delivery. Was "Requested active". */
  running: "Running",
  /** A campaign synced from Meta that AdBrain didn't launch (#763). Pause still works; resume is in Ads Manager. */
  madeOutside: "Made outside AdBrain",
} as const;

/** #2213: campaign errors owners see, each with a next step. Shared so every route says the same thing. */
export const OWNER_ERRORS = {
  campaignNotFound: "We couldn't find this campaign. It may have been deleted; refresh the page.",
  campaignStorageBusy: "We couldn't reach your campaigns just now. Try again in a minute.",
} as const;
