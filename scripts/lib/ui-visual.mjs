import sharp from "sharp";

const CHANNEL_TOLERANCE = 8;
const MAX_CHANGED_FRACTION = 0.001;

/** @typedef {{ changedPixels: number, totalPixels: number, dimensionsChanged: boolean }} ScreenshotComparison */

/**
 * @param {Buffer | string} before
 * @param {Buffer | string} after
 * @returns {Promise<ScreenshotComparison>}
 */
export async function compareScreenshots(before, after) {
  const decode = (input) => sharp(input).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [base, head] = await Promise.all([decode(before), decode(after)]);
  const totalPixels = Math.max(base.info.width * base.info.height, head.info.width * head.info.height);
  if (base.info.width !== head.info.width || base.info.height !== head.info.height) {
    return { changedPixels: totalPixels, totalPixels, dimensionsChanged: true };
  }

  let changedPixels = 0;
  for (let i = 0; i < base.data.length; i += 4) {
    if (Math.abs(base.data[i] - head.data[i]) > CHANNEL_TOLERANCE
      || Math.abs(base.data[i + 1] - head.data[i + 1]) > CHANNEL_TOLERANCE
      || Math.abs(base.data[i + 2] - head.data[i + 2]) > CHANNEL_TOLERANCE
      || Math.abs(base.data[i + 3] - head.data[i + 3]) > CHANNEL_TOLERANCE) {
      changedPixels++;
    }
  }
  return { changedPixels, totalPixels, dimensionsChanged: false };
}

/** @param {ScreenshotComparison} result */
export function isVisualRegression(result) {
  return result.dimensionsChanged || result.changedPixels > result.totalPixels * MAX_CHANGED_FRACTION;
}

/** @param {string} message */
export function isHydrationError(message) {
  return /hydration (?:failed|mismatch)|minified react error #418|text content did not match/i.test(message);
}

/**
 * @param {string[]} required
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 */
export function missingScreens(required, before, after) {
  return [
    ...required.filter((key) => !Object.hasOwn(before, key)).map((key) => `baseline: ${key}`),
    ...required.filter((key) => !Object.hasOwn(after, key)).map((key) => `head: ${key}`),
  ];
}
