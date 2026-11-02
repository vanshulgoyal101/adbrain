import { afterEach, describe, expect, it, vi } from "vitest";
import list from "./fixtures/meta/advideos-list.json";
import video from "./fixtures/meta/ad-video.json";
import create from "./fixtures/meta/create.json";
import { MetaClient, MetaError } from "@/lib/meta/client";
import {
  findAdVideoByName, readAdVideo, startAdVideo, uploadAdImageBytes, type MetaGraph,
} from "@/lib/meta/media";
import {
  CLAIM_STALE_MS, MAX_ATTEMPTS, ensureMetaMedia, metaMediaPort, uploadName,
  type MediaAsset, type MetaMediaDeps, type MetaMediaStore, type MetaUploadRow,
} from "@/services/meta-media";

// #749 (#744): the contract between an owner's file (a `media_assets` row) and Meta: its image hash or video id on
// that ad account, uploaded once. Replays Meta's recorded answers (scrubbed): `adimages` from the launch tape,
// `advideos` start/poll/389 (scripts/record-meta-ad-video.ts) and the `advideos` list (scripts/record-meta-advideos-list.ts).
type Exchange = { name?: string; method: string; path: string; form?: Record<string, string> | null; status: number; body: unknown };

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const OTHER_BUSINESS = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";
const imageAccount = list.adAccountId;
const videoAccount = video.creds.adAccountId;
const adimages = (create as unknown as Exchange[]).find((exchange) => exchange.path.endsWith("/adimages"))!;
const recordedHash = (adimages.body as { images: Record<string, { hash: string }> }).images.bytes.hash;
const listTape = list.tape as unknown as Exchange[];
const videoTape = video.tape as unknown as Exchange[];
const named = (tape: Exchange[], name: string) => tape.filter((exchange) => exchange.name === name);

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: IMAGE_ID, businessId: BUSINESS, kind: "image", status: "ready", deletedAt: null, path: `${BUSINESS}/photo.jpg`, ...overrides,
});
const videoAsset = (overrides: Partial<MediaAsset> = {}) => asset({ id: VIDEO_ID, kind: "video", path: `${BUSINESS}/clip.mp4`, ...overrides });

/** Meta's recorded answers in order; any call not on the tape fails the test (so an extra upload can't hide). */
function tapeGraph(exchanges: Exchange[]) {
  const queue = [...exchanges];
  const calls: { method: string; path: string; form: Record<string, string> | null }[] = [];
  const graph: MetaGraph = async <T,>(path: string, opts: { method?: string; form?: Record<string, string> } = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ method, path, form: opts.form ?? null });
    const index = queue.findIndex((exchange) => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${decodeURIComponent(path)}`);
    const [exchange] = queue.splice(index, 1);
    if (exchange.status >= 400) {
      const error = (exchange.body as { error: { message: string; code: number } }).error;
      throw new MetaError(error.message, exchange.status, error.code);
    }
    return exchange.body as T;
  };
  return { graph, calls, left: queue };
}

/** `media_meta_uploads` in memory, with the migration's unique key, compare-and-set and check constraints. */
function memoryStore(assets: MediaAsset[], seed: MetaUploadRow[] = []) {
  const rows = seed.map((row) => ({ ...row }));
  let next = rows.length;
  const check = (row: MetaUploadRow) => {
    expect(row.kind === "video" || (row.videoId === null && row.uploadName === null)).toBe(true);
    expect(row.kind === "image" || row.imageHash === null).toBe(true);
    expect(row.status !== "ready" || Boolean(row.imageHash || row.videoId)).toBe(true);
    expect(row.status === "error").toBe(row.problem !== null);
    expect(row.attempt).toBeGreaterThanOrEqual(1);
    expect(row.attempt).toBeLessThanOrEqual(MAX_ATTEMPTS);
    if (row.imageHash !== null) expect(row.imageHash).toMatch(/^[0-9a-f]{32}$/);
    if (row.videoId !== null) expect(row.videoId).toMatch(/^[0-9]{1,30}$/);
  };
  const store: MetaMediaStore = {
    async asset(businessId, assetId) {
      const found = assets.find((entry) => entry.id === assetId && entry.businessId === businessId);
      return found ? { ...found } : null;
    },
    async upload(assetId, adAccountId) {
      const found = rows.find((row) => row.mediaAssetId === assetId && row.adAccountId === adAccountId);
      return found ? { ...found } : null;
    },
    async insert(row) {
      if (rows.some((entry) => entry.mediaAssetId === row.mediaAssetId && entry.adAccountId === row.adAccountId)) return null;
      const saved = { ...row, id: `row-${++next}`, checkedAt: null };
      check(saved);
      rows.push(saved);
      return { ...saved };
    },
    async update(id, expect, patch) {
      const row = rows.find((entry) => entry.id === id);
      if (!row || row.status !== expect.status || row.attempt !== expect.attempt) return null;
      const saved = { ...row, ...patch };
      check(saved);
      Object.assign(row, saved);
      return { ...row };
    },
  };
  return { store, rows };
}

/** The port over a tape (MetaClient's thin methods call these same functions with its private Graph). */
const graphPort = (graph: MetaGraph, adAccountId: string) => metaMediaPort({
  adAccountId,
  uploadAdImageBytes: (bytes) => uploadAdImageBytes(graph, adAccountId, bytes),
  startAdVideo: (input) => startAdVideo(graph, adAccountId, input),
  readAdVideo: (videoId) => readAdVideo(graph, videoId),
  findAdVideoByName: (name) => findAdVideoByName(graph, adAccountId, name),
});

function deps(graph: MetaGraph, store: MetaMediaStore, adAccountId: string, now = new Date("2026-10-29T06:15:00Z")) {
  const signed: string[] = [];
  const read: string[] = [];
  const clock = { now };
  const value: MetaMediaDeps = {
    store,
    meta: graphPort(graph, adAccountId),
    readBytes: async (entry) => { read.push(entry.id); return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); },
    signedUrl: async () => { signed.push(video.clipUrl); return video.clipUrl; },
    now: () => clock.now,
  };
  return { deps: value, signed, read, clock };
}

const claim = (overrides: Partial<MetaUploadRow>): MetaUploadRow => ({
  id: "row-claim", businessId: BUSINESS, mediaAssetId: VIDEO_ID, adAccountId: videoAccount, kind: "video", attempt: 1,
  uploadName: uploadName(VIDEO_ID, 1), imageHash: null, videoId: null, status: "starting", problem: null, width: null,
  height: null, lengthMs: null, instagramEligible: null, claimedAt: "2026-10-29T07:00:00.000Z", checkedAt: null, ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("core: an owner's photo goes to Meta once per ad account (#749)", () => {
  it("uploads the stored bytes to adimages, records Meta's hash, and reuses it without calling Meta again", async () => {
    const { graph, calls } = tapeGraph([adimages]);
    const { store, rows } = memoryStore([asset()]);
    const { deps: d, read } = deps(graph, store, imageAccount);
    const first = await ensureMetaMedia(d, { businessId: BUSINESS, assetId: IMAGE_ID });
    expect(first).toEqual({ status: "ready", kind: "image", imageHash: recordedHash });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${imageAccount}/adimages`]);
    expect(read).toEqual([IMAGE_ID]);
    expect(rows).toMatchObject([{ kind: "image", status: "ready", imageHash: recordedHash, adAccountId: imageAccount }]);

    const again = await ensureMetaMedia(d, { businessId: BUSINESS, assetId: IMAGE_ID });
    expect(again).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("two requests at once both get the hash and leave one row (Meta gives the same bytes the same hash)", async () => {
    const { graph } = tapeGraph([adimages, adimages]);
    const { store, rows } = memoryStore([asset()]);
    const { deps: d } = deps(graph, store, imageAccount);
    const input = { businessId: BUSINESS, assetId: IMAGE_ID };
    const results = await Promise.all([ensureMetaMedia(d, input), ensureMetaMedia(d, input)]);
    expect(results.map((result) => result.status === "ready" && result.kind === "image" && result.imageHash)).toEqual([recordedHash, recordedHash]);
    expect(rows).toHaveLength(1);
  });

  it("a business that connects another ad account gets its own upload there", async () => {
    const { graph, calls } = tapeGraph([adimages, { ...adimages, path: "act_9000000000000009/adimages" }]);
    const { store, rows } = memoryStore([asset()]);
    await ensureMetaMedia(deps(graph, store, imageAccount).deps, { businessId: BUSINESS, assetId: IMAGE_ID });
    await ensureMetaMedia(deps(graph, store, "act_9000000000000009").deps, { businessId: BUSINESS, assetId: IMAGE_ID });
    expect(calls).toHaveLength(2);
    expect(rows.map((row) => row.adAccountId)).toEqual([imageAccount, "act_9000000000000009"]);
  });

  it("refuses another business's file, one not ready or deleted, and a malformed account, before touching Meta or the file", async () => {
    const { graph, calls } = tapeGraph([]);
    const { store, rows } = memoryStore([
      asset(), asset({ id: "55555555-5555-4555-8555-555555555555", status: "pending" }),
      asset({ id: "66666666-6666-4666-8666-666666666666", deletedAt: "2026-10-30T00:00:00Z" }),
    ]);
    const read: string[] = [];
    const ask = (businessId: string, assetId: string, adAccountId = imageAccount) => ensureMetaMedia(
      { ...deps(graph, store, adAccountId).deps, readBytes: async (entry) => { read.push(entry.id); return new Uint8Array(); } },
      { businessId, assetId },
    );
    expect(await ask(OTHER_BUSINESS, IMAGE_ID)).toEqual({ status: "refused", reason: "not_found" });
    expect(await ask(BUSINESS, "55555555-5555-4555-8555-555555555555")).toEqual({ status: "refused", reason: "not_ready" });
    expect(await ask(BUSINESS, "66666666-6666-4666-8666-666666666666")).toEqual({ status: "refused", reason: "not_ready" });
    expect(await ask(BUSINESS, IMAGE_ID, "9000000000000001")).toEqual({ status: "refused", reason: "bad_account" });
    expect(await ask(BUSINESS, IMAGE_ID, "act_1/adimages")).toEqual({ status: "refused", reason: "bad_account" });
    expect(calls).toEqual([]);
    expect(read).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("Meta's refusal comes back in plain words and records nothing (the next try may simply work)", async () => {
    const refused = { method: "POST", path: `${imageAccount}/adimages`, status: 400, body: { error: { message: "Invalid image", code: 100 } } };
    const { graph } = tapeGraph([refused]);
    const { store, rows } = memoryStore([asset()]);
    const result = await ensureMetaMedia(deps(graph, store, imageAccount).deps, { businessId: BUSINESS, assetId: IMAGE_ID });
    expect(result).toEqual({ status: "error", kind: "image", problem: { kind: "invalid", message: "Meta couldn't use this picture. Try another picture." } });
    expect(rows).toEqual([]);
  });
});

describe("core: an owner's video goes to Meta once, even when an answer is lost (#749)", () => {
  const input = { businessId: BUSINESS, assetId: VIDEO_ID };

  it("claims the row first, then starts the upload by signed URL with the claim's name; polls to ready", async () => {
    const { graph, calls } = tapeGraph([...named(videoTape, "start-video"), ...named(videoTape, "poll-video")]);
    const { store, rows } = memoryStore([videoAsset()]);
    const { deps: d } = deps(graph, store, videoAccount);
    const started = await ensureMetaMedia(d, input);
    expect(started).toEqual({ status: "processing", kind: "video", videoId: video.videoId });
    expect(calls).toEqual([{
      method: "POST", path: `${videoAccount}/advideos`,
      form: { file_url: video.clipUrl, name: uploadName(VIDEO_ID, 1), title: uploadName(VIDEO_ID, 1) },
    }]);
    expect(rows).toMatchObject([{ status: "processing", videoId: video.videoId, attempt: 1, uploadName: uploadName(VIDEO_ID, 1) }]);

    const polls = named(videoTape, "poll-video").length;
    const states = [];
    for (let i = 0; i < polls; i++) states.push(await ensureMetaMedia(d, input));
    expect(states.slice(0, -1).every((state) => state.status === "processing")).toBe(true);
    const ready = states.at(-1)!;
    expect(ready).toMatchObject({ status: "ready", kind: "video", videoId: video.videoId });
    if (ready.status !== "ready" || ready.kind !== "video") throw new Error("not ready");
    expect(ready.width).toBeGreaterThan(0);
    expect(ready.height).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ status: "ready", width: ready.width, height: ready.height });

    const callsBefore = calls.length;
    expect(await ensureMetaMedia(d, input)).toEqual(ready);
    expect(calls).toHaveLength(callsBefore);
  });

  it("two requests at once send one upload", async () => {
    const { graph, calls } = tapeGraph(named(videoTape, "start-video"));
    const { store, rows } = memoryStore([videoAsset()]);
    const { deps: d } = deps(graph, store, videoAccount);
    const results = await Promise.all([ensureMetaMedia(d, input), ensureMetaMedia(d, input)]);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(results).toContainEqual({ status: "processing", kind: "video", videoId: video.videoId });
    expect(results).toContainEqual({ status: "processing", kind: "video", videoId: null });
    expect(rows).toHaveLength(1);
  });

  it("Meta can't fetch the file (389, retried once): error in plain words; only an explicit retry sends it again, as attempt 2", async () => {
    const { graph, calls } = tapeGraph([...named(videoTape, "start-unreachable"), ...named(videoTape, "start-video")]);
    const { store, rows } = memoryStore([videoAsset()]);
    const { deps: d, signed } = deps(graph, store, videoAccount);
    const failed = await ensureMetaMedia(d, input);
    expect(failed).toEqual({ status: "error", kind: "video", problem: { kind: "unreachable", message: "Couldn't send your video to Meta. Try again." } });
    expect(signed).toHaveLength(2);
    expect(rows).toMatchObject([{ status: "error", problem: "unreachable", attempt: 1 }]);

    expect(await ensureMetaMedia(d, input)).toEqual(failed);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);

    const retried = await ensureMetaMedia(d, { ...input, retry: true });
    expect(retried).toEqual({ status: "processing", kind: "video", videoId: video.videoId });
    expect(calls.at(-1)!.form).toMatchObject({ name: uploadName(VIDEO_ID, 2), title: uploadName(VIDEO_ID, 2) });
    expect(rows).toMatchObject([{ status: "processing", attempt: 2, problem: null, uploadName: uploadName(VIDEO_ID, 2) }]);
  });

  it("an answer that never arrives (timeout, 5xx, Meta code 2) leaves the claim; nothing is sent again while it is fresh", async () => {
    for (const failure of [
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      new MetaError("Service temporarily unavailable", 500, 2),
      new MetaError("An unknown error occurred", 400, 1),
    ]) {
      let posts = 0;
      const graph: MetaGraph = async () => { posts += 1; throw failure; };
      const { store, rows } = memoryStore([videoAsset()]);
      const { deps: d, clock } = deps(graph, store, videoAccount);
      expect(await ensureMetaMedia(d, input)).toEqual({ status: "processing", kind: "video", videoId: null });
      expect(rows).toMatchObject([{ status: "starting", attempt: 1 }]);
      clock.now = new Date(clock.now.getTime() + CLAIM_STALE_MS - 1000);
      expect(await ensureMetaMedia(d, input)).toEqual({ status: "processing", kind: "video", videoId: null });
      expect(posts).toBe(1);
    }
  });

  it("a stale claim is found at Meta by its name and polled, never uploaded twice", async () => {
    // The recorded list holds the clip uploaded as "owner-clip.mp4"; the poll answers are the same clip's (ids differ per scrub).
    const foundId = (listTape[0].body as { data: { id: string }[] }).data[0].id;
    const polls = named(videoTape, "poll-video").map((exchange) => ({ ...exchange, path: exchange.path.replace(video.videoId, foundId) }));
    const listing = { ...named(listTape, "list-videos")[0], path: named(listTape, "list-videos")[0].path.replace(imageAccount, videoAccount) };
    const { graph, calls } = tapeGraph([listing, ...polls]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ uploadName: "owner-clip.mp4", claimedAt: "2026-10-29T06:15:40Z" })]);
    const { deps: d } = deps(graph, store, videoAccount, new Date("2026-10-29T06:30:00Z"));
    const result = await ensureMetaMedia(d, input);
    expect(result).toEqual({ status: "processing", kind: "video", videoId: foundId });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(rows).toMatchObject([{ status: "processing", videoId: foundId, attempt: 1 }]);
  });

  it("a stale claim Meta never got (older videos only) is claimed again as attempt 2 and sent", async () => {
    const listing = { ...named(listTape, "list-videos")[0], path: named(listTape, "list-videos")[0].path.replace(imageAccount, videoAccount) };
    const { graph, calls } = tapeGraph([listing, ...named(videoTape, "start-video")]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ claimedAt: "2026-10-29T07:00:00Z" })]);
    const { deps: d } = deps(graph, store, videoAccount, new Date("2026-10-29T07:10:00Z"));
    expect(await ensureMetaMedia(d, input)).toEqual({ status: "processing", kind: "video", videoId: video.videoId });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls[1].form).toMatchObject({ name: uploadName(VIDEO_ID, 2) });
    expect(rows).toMatchObject([{ status: "processing", attempt: 2 }]);
  });

  it("a lookup that can't settle it (200 newer videos, or Meta fails) never sends again", async () => {
    const newer = Array.from({ length: 50 }, (_, index) => ({ id: String(9100000000000000 + index), title: `other-${index}`, created_time: "2026-10-29T07:30:00+0000" }));
    let pages = 0;
    const crowded: MetaGraph = async <T,>(path: string, opts: { method?: string } = {}) => {
      if (opts.method === "POST") throw new Error("must not upload");
      expect(path).toMatch(/\/advideos\?fields=id%2Ctitle%2Ccreated_time&limit=50/);
      pages += 1;
      return { data: newer, paging: { cursors: { after: `c${pages}` }, next: "https://graph.facebook.com/next" } } as T;
    };
    const { store, rows } = memoryStore([videoAsset()], [claim({})]);
    const { deps: d } = deps(crowded, store, videoAccount, new Date("2026-10-29T07:10:00Z"));
    expect(await ensureMetaMedia(d, input)).toMatchObject({ status: "error", kind: "video", problem: { kind: "unknown" } });
    expect(pages).toBe(4);
    expect(rows).toMatchObject([{ status: "error", problem: "unknown", attempt: 1 }]);

    // The owner's retry looks again first; still unsettled, it still sends nothing.
    expect(await ensureMetaMedia(d, { ...input, retry: true })).toMatchObject({ status: "error", problem: { kind: "unknown" } });
    expect(pages).toBe(8);
    expect(rows).toMatchObject([{ status: "error", problem: "unknown", attempt: 1 }]);

    const failing: MetaGraph = async () => { throw new MetaError("Service temporarily unavailable", 503, 2); };
    const second = memoryStore([videoAsset()], [claim({})]);
    expect(await ensureMetaMedia(deps(failing, second.store, videoAccount, new Date("2026-10-29T07:10:00Z")).deps, input))
      .toEqual({ status: "processing", kind: "video", videoId: null });
    expect(second.rows).toMatchObject([{ status: "starting", attempt: 1 }]);
  });

  it("Meta refuses a title filter (recorded), so the lookup reads the list; absent only at its proven end", async () => {
    const refusal = named(listTape, "filter-by-title")[0];
    expect(refusal).toMatchObject({ status: 400, body: { error: { code: 100 } } });
    const { graph, calls } = tapeGraph(named(listTape, "list-videos"));
    expect(await findAdVideoByName(graph, imageAccount, "owner-clip.mp4"))
      .toEqual({ status: "found", videoId: (listTape[0].body as { data: { id: string }[] }).data[0].id });
    expect(calls[0].path).not.toContain("filtering");

    // Order isn't promised: an older video listed before the match doesn't end the search.
    const [newest, oldest] = (listTape[0].body as { data: object[] }).data;
    const shuffled = { ...listTape[0], body: { data: [oldest, newest], paging: {} } };
    expect(await findAdVideoByName(tapeGraph([shuffled]).graph, imageAccount, "owner-clip.mp4"))
      .toMatchObject({ status: "found" });

    // A page mixing an older video with newer ones isn't the end: the match on the next page is still found.
    const mixed = { ...listTape[0], body: { data: [oldest, { id: "9100000000000001", title: "other", created_time: "2026-10-29T07:00:00+0000" }], paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/next" } } };
    const nextPage = { ...listTape[0], path: `${listTape[0].path}&after=c1`, body: { data: [newest], paging: {} } };
    expect(await findAdVideoByName(tapeGraph([mixed, nextPage]).graph, imageAccount, "owner-clip.mp4"))
      .toMatchObject({ status: "found" });

    // A whole page older than the claim isn't the end either: the order isn't promised.
    const allOlder = { ...mixed, body: { ...mixed.body, data: [oldest] } };
    expect(await findAdVideoByName(tapeGraph([allOlder, nextPage]).graph, imageAccount, "owner-clip.mp4"))
      .toMatchObject({ status: "found" });

    // Only a last page (no `next`) proves absence; a `next` with no cursor can't be followed, so it stays unknown.
    expect(await findAdVideoByName(tapeGraph([{ ...listTape[0], body: { data: [oldest], paging: {} } }]).graph, imageAccount, "owner-clip.mp4"))
      .toEqual({ status: "absent" });
    const noCursor = { ...mixed, body: { data: [oldest], paging: { next: "https://graph.facebook.com/next" } } };
    expect(await findAdVideoByName(tapeGraph([noCursor]).graph, imageAccount, "owner-clip.mp4"))
      .toEqual({ status: "unknown" });
  });

  it("in production the port is the business's MetaClient: its account, its Graph, its write mode", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      urls.push(url.pathname + url.search);
      return Response.json(listTape[0].body);
    });
    const creds = { adAccountId: imageAccount, pageId: "1", accessToken: "core-token" };
    const port = metaMediaPort(new MetaClient(creds));
    expect(port.adAccountId).toBe(imageAccount);
    expect(await port.findVideoByName("owner-clip.mp4")).toMatchObject({ status: "found" });
    expect(urls[0]).toContain(`/${imageAccount}/advideos?`);

    // The smoke account's client is pause-only: an owner's upload can't reach Meta through it.
    const pauseOnly = metaMediaPort(new MetaClient(creds, undefined, "pause-only"));
    await expect(pauseOnly.startVideo({ fileUrl: () => video.clipUrl, name: "n", title: "t" })).rejects.toThrow();
    await expect(pauseOnly.uploadImage(new Uint8Array([1]))).rejects.toThrow();
    expect(urls).toHaveLength(1);
  });

  it("a claim 3 minutes old is still in flight (another host's clock may be slow): nothing is looked up or sent", async () => {
    const { graph, calls } = tapeGraph([]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ claimedAt: "2026-10-29T06:12:00Z" })]);
    expect(await ensureMetaMedia(deps(graph, store, videoAccount, new Date("2026-10-29T06:15:00Z")).deps, input))
      .toEqual({ status: "processing", kind: "video", videoId: null });
    expect(calls).toEqual([]);
    expect(rows).toMatchObject([{ status: "starting", attempt: 1 }]);
  });

  it("the attempt cap holds on every path, including a stale claim Meta never got", async () => {
    const listing = { ...named(listTape, "list-videos")[0], path: named(listTape, "list-videos")[0].path.replace(imageAccount, videoAccount) };
    const { graph, calls } = tapeGraph([listing]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ attempt: MAX_ATTEMPTS, uploadName: uploadName(VIDEO_ID, MAX_ATTEMPTS) })]);
    expect(await ensureMetaMedia(deps(graph, store, videoAccount, new Date("2026-10-29T07:10:00Z")).deps, input))
      .toMatchObject({ status: "error", kind: "video" });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(rows).toMatchObject([{ status: "error", problem: "unknown", attempt: MAX_ATTEMPTS }]);
  });

  it("a signed link that can't be made sends nothing and can be retried", async () => {
    const { graph, calls } = tapeGraph(named(videoTape, "start-video"));
    const { store, rows } = memoryStore([videoAsset()]);
    const built = deps(graph, store, videoAccount);
    const broken = { ...built.deps, signedUrl: async () => { throw new Error("storage down"); } };
    expect(await ensureMetaMedia(broken, input)).toMatchObject({ status: "error", problem: { kind: "unreachable" } });
    expect(calls).toEqual([]);
    expect(rows).toMatchObject([{ status: "error", problem: "unreachable", attempt: 1 }]);
    expect(await ensureMetaMedia(built.deps, { ...input, retry: true })).toEqual({ status: "processing", kind: "video", videoId: video.videoId });
  });

  it("a poll Meta refuses (token gone) shows reconnect without marking the video retryable", async () => {
    const poll = named(videoTape, "poll-video")[0];
    const revoked = { ...poll, status: 400, body: { error: { message: "Error validating access token", code: 190 } } };
    const { graph } = tapeGraph([revoked]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ status: "processing", videoId: video.videoId })]);
    expect(await ensureMetaMedia(deps(graph, store, videoAccount).deps, input))
      .toMatchObject({ status: "error", problem: { kind: "reconnect" } });
    expect(rows).toMatchObject([{ status: "processing", videoId: video.videoId }]);
  });

  it("Meta's processing error is recorded; a retry is capped", async () => {
    const failedPoll = { ...named(videoTape, "poll-video")[0], body: { id: video.videoId, status: { video_status: "error" } } };
    const { graph } = tapeGraph([failedPoll]);
    const { store, rows } = memoryStore([videoAsset()], [claim({ status: "processing", videoId: video.videoId })]);
    const { deps: d } = deps(graph, store, videoAccount);
    expect(await ensureMetaMedia(d, input)).toEqual({
      status: "error", kind: "video", problem: { kind: "file", message: "Meta couldn't use this video file. Try another video." },
    });
    expect(rows).toMatchObject([{ status: "error", problem: "file" }]);

    const capped = memoryStore([videoAsset()], [claim({ status: "error", problem: "file", attempt: 20 })]);
    const noCalls = tapeGraph([]);
    expect(await ensureMetaMedia(deps(noCalls.graph, capped.store, videoAccount).deps, { ...input, retry: true })).toMatchObject({ status: "error" });
    expect(noCalls.calls).toEqual([]);
  });
});
