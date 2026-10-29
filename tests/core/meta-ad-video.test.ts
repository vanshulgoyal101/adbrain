import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-video.json";
import { MetaClient, MetaError } from "@/lib/meta/client";
import { adVideoProblem, decodeAdVideo } from "@/lib/meta/media";

// #749 (#744 plan 2): Meta's real answers for an owner's video (scripts/record-meta-ad-video.ts, scrubbed):
// one tiny public clip uploaded to the test ad account by `file_url` and polled to ready (no ad, no spend),
// a URL Meta can't fetch (error 389), and the Video node of a video already in that account.
type Exchange = { name: string; method: string; path: string; form: Record<string, string> | null; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const creds = { ...recorded.creds, accessToken: "core-token" };

function replay(name: string) {
  const calls: { method: string; path: string; form: Record<string, string> | null }[] = [];
  const queue = tape.filter((exchange) => exchange.name === name);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    const form = method === "POST" ? Object.fromEntries([...new URLSearchParams(String(init?.body))].filter(([key]) => key !== "access_token")) : null;
    calls.push({ method, path, form });
    const index = queue.findIndex((exchange) => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${decodeURIComponent(path)}`);
    const [exchange] = queue.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("core: an owner's video goes to Meta by URL and is polled until ready (#749)", () => {
  it("starts the upload with the signed URL, a name and a title; Meta answers with the video id", async () => {
    const calls = replay("start-video");
    const videoId = await new MetaClient(creds).startAdVideo({ fileUrl: () => recorded.clipUrl, name: "owner-clip.mp4", title: "Owner clip" });
    expect(videoId).toBe(recorded.videoId);
    expect(calls).toEqual([{ method: "POST", path: `${creds.adAccountId}/advideos`, form: { file_url: recorded.clipUrl, name: "owner-clip.mp4", title: "Owner clip" } }]);
  });

  it("polls the Video node: processing until Meta says ready, then its real size and preferred thumbnail", async () => {
    replay("poll-video");
    const meta = new MetaClient(creds);
    const polls = tape.filter((exchange) => exchange.name === "poll-video");
    const states = [];
    for (let i = 0; i < polls.length; i++) states.push(await meta.readAdVideo(recorded.videoId));
    expect(states.slice(0, -1).every((state) => state.status === "processing")).toBe(true);
    // While processing Meta answers 0×0, length 0 and a placeholder picture: unknown, not a real size.
    expect(states[0]).toMatchObject({ width: null, height: null, lengthSeconds: null, thumbnailUrl: null });
    const ready = states.at(-1)!;
    expect(ready.status).toBe("ready");
    expect(ready.width).toBeGreaterThan(0);
    expect(ready.height).toBeGreaterThan(0);
    expect(ready.thumbnailUrl).toMatch(/^https:\/\//);
  });

  it("a video already in the account reads as ready, with Instagram eligibility", async () => {
    replay("read-existing-video");
    const state = await new MetaClient(creds).readAdVideo(recorded.existingVideoId);
    expect(state.status).toBe("ready");
    expect(typeof state.instagramEligible).toBe("boolean");
  });

  it("Meta can't fetch the URL (389): exactly one retry with a fresh signed URL, then plain words", async () => {
    const calls = replay("start-unreachable");
    let signed = 0;
    const error = await new MetaClient(creds).startAdVideo({
      fileUrl: () => { signed += 1; return recorded.unreachableUrl; }, name: "missing.mp4", title: "Missing",
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MetaError);
    expect((error as MetaError).code).toBe(389);
    expect(signed).toBe(2);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    expect(adVideoProblem(error)).toEqual({ kind: "unreachable", message: "Couldn't send your video to Meta. Try again." });
  });

  it("a title over Meta's 255 characters is cut, never refused", async () => {
    const calls = replay("start-video");
    await new MetaClient(creds).startAdVideo({ fileUrl: () => recorded.clipUrl, name: "owner-clip.mp4", title: "Owner clip" + " ".repeat(300) });
    expect(calls[0].form!.title.length).toBeLessThan(255);
  });
});

describe("#749: Meta's video words (documented codes; Ad Videos reference)", () => {
  it("decodes video_status: ready goes, error stops, anything else keeps polling", () => {
    expect(decodeAdVideo({ id: "1", status: { video_status: "ready" } }).status).toBe("ready");
    expect(decodeAdVideo({ id: "1", status: { video_status: "error" } }).status).toBe("error");
    expect(decodeAdVideo({ id: "1", status: { video_status: "processing" } }).status).toBe("processing");
    expect(decodeAdVideo({ id: "1", status: { video_status: "upload_complete" } }).status).toBe("processing");
    expect(decodeAdVideo({ id: "1" }).status).toBe("processing");
  });

  it("maps each documented error to one plain line; a token or permission error is a reconnect, not a media error", () => {
    const problem = (code: number) => adVideoProblem(new MetaError("x", 400, code)).kind;
    expect(problem(352)).toBe("format");
    for (const code of [351, 6000, 6001]) expect(problem(code)).toBe("file");
    expect(problem(382)).toBe("too_small");
    for (const code of [190, 200]) expect(problem(code)).toBe("reconnect");
    expect(problem(80004)).toBe("throttled");
    expect(problem(1)).toBe("unknown");
    expect(adVideoProblem(new Error("network")).kind).toBe("unknown");
  });
});
