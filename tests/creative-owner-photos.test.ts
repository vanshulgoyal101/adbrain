import { describe, expect, it } from "vitest";
import { ownerPhotoFor, preferCleanPhotos } from "@/lib/creative/owner-photos";
import { AD_ANGLES } from "@/lib/templates/ads";

// #1901 (#1879 slice 1): ads 1..min(k, 3) each use a different owner photo, newest first; the rest get AI pictures.
const photos = (k: number) => Array.from({ length: k }, (_, index) => `https://x.supabase.co/storage/v1/object/public/brand-assets/b/p${index}.jpg`);
const assign = (k: number) => AD_ANGLES.slice(0, 4).map((angle) => ownerPhotoFor(angle, photos(k)));

describe("owner photos fill Create's ads first (#1901)", () => {
  it.each([
    [0, [undefined, undefined, undefined, undefined]],
    [1, ["p0", undefined, undefined, undefined]],
    [2, ["p0", "p1", undefined, undefined]],
    [5, ["p0", "p1", "p2", undefined]],
  ])("with %i owner photos", (k, expected) => {
    expect(assign(k).map((url) => url?.match(/(p\d)\.jpg$/)?.[1])).toEqual(expected);
  });

  it("keeps an ad's photo when only that ad is made again", () => {
    expect(ownerPhotoFor(AD_ANGLES[1], photos(2))).toBe(photos(2)[1]);
    expect(ownerPhotoFor(AD_ANGLES[1], undefined)).toBeUndefined();
  });
});

describe("clean photos come first", () => {
  it("moves photos with printed text behind clean ones, keeping order otherwise", () => {
    const [a, b, c] = photos(3);
    const notes = { [a]: { description: "flyer", visibleText: "PRECIOUS MARBLES" }, [c]: { description: "roof", visibleText: null } };
    expect(preferCleanPhotos([a, b, c], notes)).toEqual([b, c, a]);
    expect(preferCleanPhotos([a, b], {})).toEqual([a, b]);
  });
});
