/**
 * #906: WhatsApp ads (and lead-form ads, #680) run on Facebook, Instagram and Messenger only. On #157, 22% of "opened WhatsApp" taps
 * came from Audience Network at a 6.7% CTR, mostly accidental. Positions stay automatic within these.
 * Shared by the Meta client (server) and the plan check (also rendered in the browser).
 */
export const WHATSAPP_PUBLISHER_PLATFORMS = ["facebook", "instagram", "messenger"];

/** Facebook's feed-style positions, which take the 4:5 image in a placement creative (#333). */
export const FACEBOOK_FEED_POSITIONS = ["feed", "right_hand_column", "marketplace", "video_feeds", "search", "instream_video", "facebook_reels_overlay", "profile_feed", "notification", "biz_disco_feed"];

/**
 * #2273 (#680 placement test): every Facebook position except Reels, which took ~25% of Solaride's spend for 1 of 6 chats.
 * Instagram and Messenger stay automatic. Reels overlay banners stay: they are a separate position Meta reports on its own.
 * Meta refuses an ad set that names video_feeds ("being discontinued", 100/2490562; no-facebook-reels-validate.json).
 */
export const FACEBOOK_POSITIONS_WITHOUT_REELS = [...FACEBOOK_FEED_POSITIONS.filter((position) => position !== "video_feeds"), "story"];
