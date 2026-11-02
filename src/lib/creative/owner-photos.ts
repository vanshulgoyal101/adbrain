import { AD_ANGLES, type AdAngle } from "@/lib/templates/ads";

/** Ads that use the owner's own photos before AI pictures (#1901). */
const OWNER_PHOTO_ADS = 3;

/**
 * #1901: ads 1..min(k, 3) each use a different owner photo (newest first); the rest get AI pictures.
 * Tied to the angle's place, so a retried ad keeps its own photo.
 */
export function ownerPhotoFor(angle: AdAngle, photos: readonly string[] | undefined): string | undefined {
  const place = AD_ANGLES.findIndex((item) => item.id === angle.id);
  return place >= 0 && place < OWNER_PHOTO_ADS ? photos?.[place] : undefined;
}

/** #2222: the owner photo an ad uses when paid pictures are paused; the ad's place picks it, so a retry gets the same one. */
export function pausedPhotoFor(angle: AdAngle, photos: readonly string[] | undefined): string | undefined {
  return photos?.length ? photos[Math.max(0, AD_ANGLES.findIndex((item) => item.id === angle.id)) % photos.length] : undefined;
}
