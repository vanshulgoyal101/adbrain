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