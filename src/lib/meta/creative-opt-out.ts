/**
 * #1932 (Analyst #1912, CTO): Meta's Advantage+ creative enhancements that change a picture, video or the words.
 * All are OPT_OUT today only because the API default says so; every creative AdBrain builds says it explicitly,
 * so a silent default change can't put generated backgrounds or touch-ups on an owner's real-work photo (#744, #1859).
 */
export const CREATIVE_FEATURES_OPT_OUT = [
  "image_background_gen", "image_touchups", "image_enhancement", "image_brightness_and_contrast", "image_uncrop",
  "image_auto_crop", "image_animation", "image_templates", "pac_genai_recomposition", "add_text_overlay", "text_generation",
  "music_generation", "audio", "video_voiceover", "translate_voiceover", "ig_video_native_subtitle", "wa_mm_image_filtering",
] as const;

/** Spread into every `adcreatives` POST form. */
export const CREATIVE_OPT_OUT_FORM = {
  degrees_of_freedom_spec: JSON.stringify({
    creative_features_spec: Object.fromEntries(CREATIVE_FEATURES_OPT_OUT.map((feature) => [feature, { enroll_status: "OPT_OUT" }])),
  }),
};
