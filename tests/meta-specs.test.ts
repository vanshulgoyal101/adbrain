import { describe, expect, it } from "vitest";
import { META_SPEC_RULES, checkMetaSpecs, type MediaFacts, type MetaSpecVerdict } from "@/lib/media/meta-specs";

// #751: owners' photos and videos checked against Meta's ads-guide limits (Analyst table, Nov 2) before upload,
// at finalize and in Review. Hard limits block; recommendations only warn.
const MB = 1024 * 1024;
const photo = (width: number, height: number, bytes = 2 * MB, mime = "image/jpeg"): MediaFacts => ({ mime, width, height, bytes });
const video = (width: number, height: number, durationSec: number, bytes = 50 * MB, mime = "video/mp4"): MediaFacts => ({ mime, width, height, bytes, durationSec });
const msg = (v: MetaSpecVerdict) => ("message" in v ? v.message : "");
const statuses = (facts: MediaFacts) => {
  const v = checkMetaSpecs(facts);
  return [v.feed.status, v.stories.status, v.reels.status];
};

describe("checkMetaSpecs photos (#751)", () => {
  it.each([
    ["4:5", 1440, 1800],
    ["1:1", 1080, 1080],
    ["1.91:1", 1200, 628],
  ])("a %s photo is fine in Feed", (_name, w, h) => {
    expect(checkMetaSpecs(photo(w, h)).feed).toEqual({ status: "ok" });
  });

  it("a 9:16 photo is fine in Stories and Reels", () => {
    const v = checkMetaSpecs(photo(1440, 2560));
    expect(v.stories).toEqual({ status: "ok" });
    expect(v.reels).toEqual({ status: "ok" });
  });

  it("a wide 16:9 photo is fine in Feed and offers a tall picture for Stories and Reels", () => {
    const v = checkMetaSpecs(photo(1920, 1080));
    expect(v.feed.status).toBe("ok");
    for (const p of [v.stories, v.reels]) {
      expect(p).toMatchObject({ status: "warn", fix: "fit-tall" });
      expect(msg(p)).toMatch(/tall picture/);
    }
  });

  it("a tall 9:16 photo is shown cropped in Feed: a warning, not a block", () => {
    expect(checkMetaSpecs(photo(1440, 2560)).feed).toMatchObject({ status: "warn", fix: "replace" });
  });

  it("uses Meta's 3% Feed tolerance and 1% Stories tolerance at the edges", () => {
    // 4:5 is 0.8; 3% narrower is 0.776.
    expect(checkMetaSpecs(photo(777, 1000)).feed.status).toBe("ok");
    expect(checkMetaSpecs(photo(770, 1000)).feed.status).toBe("warn");
    // 9:16 is 0.5625; 1% either side is 0.5569–0.5681.
    expect(checkMetaSpecs(photo(5620, 10000)).stories.status).toBe("ok");
    expect(checkMetaSpecs(photo(5680, 10000)).stories.status).toBe("ok");
    expect(checkMetaSpecs(photo(5700, 10000)).stories.status).toBe("warn");
  });

  it("blocks a photo too small for Meta everywhere, naming the size it needs", () => {
    const v = checkMetaSpecs(photo(400, 500));
    expect([v.feed.status, v.stories.status, v.reels.status]).toEqual(["block", "block", "block"]);
    expect(v.feed).toMatchObject({ fix: "replace" });
    expect(msg(v.feed)).toMatch(/600 px/);
    expect(msg(v.stories)).toMatch(/500 px/);
  });

  it("blocks Feed only when a photo fits Stories' 500 px but not Feed's 600 px", () => {
    expect(statuses(photo(540, 960))).toEqual(["block", "ok", "ok"]);
  });

  it("blocks a photo over 30 MB", () => {
    const v = checkMetaSpecs(photo(1440, 1800, 40 * MB));
    expect(statuses(photo(1440, 1800, 40 * MB))).toEqual(["block", "block", "block"]);
    expect(msg(v.feed)).toMatch(/30 MB/);
    expect(statuses(photo(1440, 1800, 30 * MB)).includes("block")).toBe(false);
  });

  it("accepts JPG and PNG but not other image types", () => {
    expect(checkMetaSpecs(photo(1080, 1080, MB, "image/png")).feed.status).toBe("ok");
    const v = checkMetaSpecs(photo(1080, 1080, MB, "image/heic"));
    expect(statuses(photo(1080, 1080, MB, "image/heic"))).toEqual(["block", "block", "block"]);
    expect(v.feed).toMatchObject({ fix: "replace" });
    expect(msg(v.feed)).toMatch(/JPG or PNG/);
  });
});

describe("checkMetaSpecs videos (#751)", () => {
  it("a 9:16 30-second video is fine everywhere tall, cropped in Feed", () => {
    expect(statuses(video(1080, 1920, 30))).toEqual(["warn", "ok", "ok"]);
  });

  it("a 4:5 video is fine in Feed and Feed-only for Stories and Reels (no video crop yet)", () => {
    const v = checkMetaSpecs(video(1080, 1350, 20));
    expect(v.feed).toEqual({ status: "ok" });
    expect(v.stories).toMatchObject({ status: "warn", fix: "feed-only" });
    expect(v.reels).toMatchObject({ status: "warn", fix: "feed-only" });
  });

  it("a 3-minute video is over Stories' limit only", () => {
    expect(statuses(video(1080, 1920, 180))).toEqual(["warn", "ok", "ok"]);
    const v = checkMetaSpecs(video(1080, 1920, 181));
    expect(v.stories).toMatchObject({ status: "block", fix: "feed-only" });
    expect(msg(v.stories)).toMatch(/3 minutes/);
    expect(v.reels.status).toBe("ok");
  });

  it("blocks a video under 1 second in Feed and Stories, and one over 15 minutes in Reels", () => {
    expect(statuses(video(1080, 1920, 0.5))).toEqual(["block", "block", "ok"]);
    expect(checkMetaSpecs(video(1080, 1920, 16 * 60)).reels.status).toBe("block");
  });

  it("Reels needs 500 px wide from 30 seconds; under 30 s 250 px is enough", () => {
    expect(checkMetaSpecs(video(270, 480, 29)).reels.status).toBe("ok");
    expect(checkMetaSpecs(video(270, 480, 30)).reels).toMatchObject({ status: "block", fix: "replace" });
    expect(checkMetaSpecs(video(240, 426, 10)).stories.status).toBe("block");
  });

  it("blocks a video over 4 GB and other video types than MP4 and MOV", () => {
    expect(statuses(video(1080, 1920, 30, 5 * 1024 * MB))).toEqual(["block", "block", "block"]);
    expect(checkMetaSpecs(video(1080, 1920, 30, MB, "video/quicktime")).stories.status).toBe("ok");
    expect(msg(checkMetaSpecs(video(1080, 1920, 30, MB, "video/webm")).feed)).toMatch(/MP4 or MOV/);
  });

  it("a video without a readable length can't be checked", () => {
    const v = checkMetaSpecs({ mime: "video/mp4", width: 1080, height: 1920, bytes: MB });
    expect(v.feed).toMatchObject({ status: "block", fix: "replace" });
    expect(msg(v.feed)).toMatch(/can't read/);
  });
});

describe("checkMetaSpecs unreadable files (#751)", () => {
  it.each([
    [{ mime: "image/jpeg", width: 0, height: 1080, bytes: MB }],
    [{ mime: "image/jpeg", width: Number.NaN, height: 1080, bytes: MB }],
    [{ mime: "image/jpeg", width: 1080, height: 1080, bytes: -1 }],
  ])("says it can't read %o instead of guessing", (facts) => {
    const v = checkMetaSpecs(facts);
    for (const p of [v.feed, v.stories, v.reels]) {
      expect(p).toMatchObject({ status: "block", fix: "replace" });
      expect(msg(p)).toMatch(/can't read this file/);
    }
  });
});

describe("META_SPEC_RULES (#751)", () => {
  it("every rule names the Meta page it came from and when it was checked", () => {
    for (const rule of Object.values(META_SPEC_RULES)) {
      expect(rule.source).toMatch(/^https:\/\/www\.facebook\.com\/business\/ads-guide\//);
      expect(rule.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
