import { describe, expect, it } from "vitest";
import { pictureSources } from "../scripts/lib/smoke-pictures.mjs";

const own = (provider: string, imageAttempts: object[] = [{ provider, status: "success" }]) => ({ generation: { image: { provider }, imageAttempts } });
const reused = (provider: string) => ({ generation: { image: { provider, fallbackFrom: "batch_reuse" }, imageAttempts: [{ provider: "pollinations", status: "error", errorCode: "IMAGE_FREE_BUSY" }] } });

describe("Create smoke: where each picture came from (#2412)", () => {
  it("passes 3 own Cloudflare pictures and prints the counts", () => {
    expect(pictureSources([own("cloudflare"), own("cloudflare"), own("cloudflare")], { expectCloudflare: true }))
      .toEqual({ line: "NOTE pictures: cloudflare 3, pollinations 0, reuse 0", failure: null });
  });

  it("allows one reused picture", () => {
    expect(pictureSources([own("cloudflare"), own("cloudflare"), reused("cloudflare")], { expectCloudflare: true }).failure).toBeNull();
  });

  it("fails 1 real picture plus 2 reused ones (#2145's 1-of-3 hiding as 3/3)", () => {
    const result = pictureSources([own("pollinations"), reused("pollinations"), reused("pollinations")], { expectCloudflare: false });
    expect(result.line).toBe("NOTE pictures: cloudflare 0, pollinations 1, reuse 2");
    expect(result.failure).toBe("2 of 3 pictures reused a sibling's (free pictures busy)");
  });

  it("fails when Cloudflare is expected but every picture came from Pollinations (revoked or expired token)", () => {
    const failed = [{ provider: "cloudflare", status: "error", errorCode: "IMAGE_PROVIDER" }, { provider: "pollinations", status: "success" }];
    expect(pictureSources([own("pollinations", failed), own("pollinations", failed), own("pollinations", failed)], { expectCloudflare: true }).failure)
      .toBe("Cloudflare is configured but no picture came from it (attempts: IMAGE_PROVIDER)");
  });

  it("treats a Cloudflare attempt as configured even without the flag", () => {
    const failed = [{ provider: "cloudflare", status: "error", errorCode: "IMAGE_PROVIDER" }, { provider: "pollinations", status: "success" }];
    expect(pictureSources([own("pollinations", failed)], { expectCloudflare: false }).failure).toMatch(/^Cloudflare is configured/);
  });

  it("only notes Cloudflare's daily cap, which resets at 00:00 UTC", () => {
    const capped = [{ provider: "cloudflare", status: "error", errorCode: "IMAGE_FREE_DAILY_LIMIT" }, { provider: "pollinations", status: "success" }];
    expect(pictureSources([own("pollinations", capped), own("pollinations", capped), own("pollinations", capped)], { expectCloudflare: true }))
      .toEqual({ line: "NOTE pictures: cloudflare 0, pollinations 3, reuse 0 (Cloudflare's free daily cap was used up)", failure: null });
  });

  it("passes Pollinations alone when Cloudflare isn't configured", () => {
    expect(pictureSources([own("pollinations"), own("pollinations"), own("pollinations")], { expectCloudflare: false }).failure).toBeNull();
  });
});
