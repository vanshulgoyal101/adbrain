import { afterEach, describe, expect, it, vi } from "vitest";

// #781: a photo and a ready owner video in one launch. The video's creative is the shape Meta accepted
// (video-creative-validate.json, #749); only the photo is uploaded as an image.
vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

import { MetaClient } from "@/lib/meta/client";

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };

async function launch(video: { status: "ready" | "processing"; thumbnailUrl: string | null }, destination: "instant_form" | "website" = "instant_form") {
  const client = new MetaClient(creds);
  const upload = vi.spyOn(client, "uploadAdImage").mockResolvedValue("image-hash");
  vi.spyOn(client, "readAdVideo").mockResolvedValue({ ...video, width: 1080, height: 1920, lengthSeconds: 12, instagramEligible: true });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
  const run = client.createLeadCampaign({
    name: "AdBrain #781", dailyBudgetRupees: 280, destination, link: "https://example.com", leadFormId: "form-1",
    creatives: [
      { imageUrl: "https://example.com/photo.png", headline: "Photo", message: "Photo text" },
      { imageUrl: "https://example.com/poster.png", headline: "Video", message: "Video text", videoId: "9000000000000009" },
    ],
    location: { cities: [{ key: "1021145" }] }, ageMin: 25, ageMax: 55,
  });
  return { run, upload, forms: () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init?.body))) })) };
}

afterEach(() => vi.restoreAllMocks());

describe("core: mixed photo and video launch (#781)", () => {
  it("uploads the photo only and sends the video as video_data with its Meta thumbnail", async () => {
    const { run, upload, forms } = await launch({ status: "ready", thumbnailUrl: "https://scontent.example/thumb.jpg" });
    await run;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("https://example.com/photo.png");
    const specs = forms().filter(({ url }) => url.endsWith("/adcreatives")).map(({ form }) => JSON.parse(form.object_story_spec));
    expect(specs).toHaveLength(2);
    expect(specs[0].link_data.image_hash).toBe("image-hash");
    expect(specs[1].video_data).toMatchObject({ video_id: "9000000000000009", image_url: "https://scontent.example/thumb.jpg", message: "Video text", title: "Video" });
    expect(specs[1].link_data).toBeUndefined();
  });

  it("stops before any ad when the video isn't ready at Meta", async () => {
    const { run, forms } = await launch({ status: "processing", thumbnailUrl: null });
    await expect(run).rejects.toThrow(/isn't ready/);
    expect(forms().some(({ url }) => url.endsWith("/ads"))).toBe(false);
  });

  it("refuses a video for a website campaign", async () => {
    const { run } = await launch({ status: "ready", thumbnailUrl: "https://scontent.example/thumb.jpg" }, "website");
    await expect(run).rejects.toThrow(/website/);
  });
});
