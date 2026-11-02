export function canUseMetaConnect(
  userId: string,
  config = {
    environment: process.env.NODE_ENV,
    rollout: process.env.META_CONNECT_ROLLOUT,
    pilotUserId: process.env.META_CONNECT_PILOT_USER_ID,
  },
): boolean {
  if (config.rollout === "disabled") return false;
  if (config.rollout === "pilot") return Boolean(config.pilotUserId && userId === config.pilotUserId);
  if (config.rollout === "enabled") return true;
  return config.environment !== "production" && !config.rollout;
}
/**
 * #1989: until Meta's App Review passes (#156), only people with a role on the app (Testers) can log in to it.
 * On unless set to exactly `false`, which DevOps does once #156 is approved.
 */
export function metaAppReviewPending(value = process.env.META_APP_REVIEW_PENDING): boolean {
  return value !== "false";
}
