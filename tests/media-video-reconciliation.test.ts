import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeUpload, signUpload, type MediaRow } from "@/lib/media/store";
import { fakeSupabase } from "./helpers/media-fake";

const env = vi.hoisted(() => ({ MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: true }));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const VIDEO = new Uint8Array(readFileSync("tests/fixtures/media/tall.mp4"));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type FinalizeState =
  | { status: "reserved" }
  | { status: "writing"; final_path: string; attempt_id: string; expected_sha256: string; expected_bytes: number }
  | { status: "claimed"; final_path: string; attempt_id: string; expected_sha256: string; expected_bytes: number }
  | { status: "ready"; final_path: string };

describe("video finalization reconciliation", () => {
  let db: ReturnType<typeof fakeSupabase>;
  let admin: ReturnType<typeof fakeSupabase>["client"] & {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  let states: Map<string, FinalizeState>;
  let failNextComplete: boolean;
  let uploadMode: "before-accept" | "after-accept" | "definitive-reject" | null;
  let uploadAttempts: string[];
  let terminalAttempts: string[];
  let beforeUpload: (() => Promise<void>) | null;
  let completedAttempts: string[];
  let attemptNumber: number;

  beforeEach(() => {
    db = fakeSupabase();
    states = new Map();
    failNextComplete = false;
    uploadMode = null;
    uploadAttempts = [];
    terminalAttempts = [];
    beforeUpload = null;
    completedAttempts = [];
    attemptNumber = 0;
    admin = Object.assign(db.client, {
      rpc: async (name: string, args: Record<string, unknown>) => {
        const assetId = String(args.p_asset_id);
        const state = states.get(assetId);
        if (name === "media_video_finalize_state") {
          return { data: state ?? { status: "reserved" }, error: null };
        }
        if (name === "media_video_finalize_claim") {
          if (state && state.status !== "reserved") {
            const existing = state;
            return {
              data: [{
                state: existing.status === "ready" ? "ready" : existing.status,
                final_path: existing.final_path,
                attempt_id: existing.status === "ready" ? null : existing.attempt_id,
                expected_sha256: existing.status === "ready" ? null : existing.expected_sha256,
                expected_bytes: existing.status === "ready" ? null : existing.expected_bytes,
                newly_claimed: false,
                matches_request: existing.status === "ready"
                  || (existing.expected_sha256 === args.p_expected_sha256 && existing.expected_bytes === args.p_expected_bytes),
              }],
              error: null,
            };
          }
          attemptNumber += 1;
          const claimed: FinalizeState = {
            status: "claimed",
            final_path: String(args.p_candidate_final_path),
            attempt_id: attemptNumber === 1 ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444",
            expected_sha256: String(args.p_expected_sha256),
            expected_bytes: Number(args.p_expected_bytes),
          };
          states.set(assetId, { ...claimed, status: "writing" });
          return {
            data: [{
              state: "writing",
              final_path: claimed.final_path,
              attempt_id: claimed.attempt_id,
              expected_sha256: claimed.expected_sha256,
              expected_bytes: claimed.expected_bytes,
              newly_claimed: true,
              matches_request: true,
            }],
            error: null,
          };
        }
        if (name === "media_video_finalize_complete") {
          completedAttempts.push(String(args.p_attempt_id));
          if (failNextComplete) {
            failNextComplete = false;
            return { data: null, error: { message: "database response lost" } };
          }
          const current = states.get(assetId);
          if (current?.status !== "writing" || current.attempt_id !== args.p_attempt_id
            || current.final_path !== args.p_final_path || current.expected_sha256 !== args.p_expected_sha256
            || current.expected_bytes !== args.p_expected_bytes) {
            return { data: null, error: { message: "stale finalization attempt" } };
          }
          if (!args.p_checks || typeof args.p_checks !== "object") {
            return { data: null, error: { message: "missing completion checks" } };
          }
          const row = db.tables.media_assets.find((asset) => asset.id === assetId);
          if (!row) return { data: null, error: { message: "asset not found" } };
          Object.assign(row, {
            path: current.final_path,
            status: "ready",
            bytes: current.expected_bytes,
            mime: "video/mp4",
            width: 720,
            height: 1280,
            duration_ms: 2000,
            checks: args.p_checks,
          });
          states.set(assetId, { status: "ready", final_path: current.final_path });
          return { data: true, error: null };
        }
        if (name === "media_video_finalize_terminal") {
          terminalAttempts.push(String(args.p_attempt_id));
          const current = states.get(assetId);
          if (current?.status !== "writing" || current.attempt_id !== args.p_attempt_id
            || db.objects.has(current.final_path)) return { data: false, error: null };
          states.set(assetId, { status: "reserved" });
          return { data: true, error: null };
        }
        return { data: null, error: { message: `unexpected RPC ${name}` } };
      },
    });
    const storageFrom = admin.storage.from.bind(admin.storage);
    vi.spyOn(admin.storage, "from").mockImplementation((bucket) => {
      const storage = storageFrom(bucket);
      const upload = storage.upload.bind(storage);
      return Object.assign(storage, {
        upload: async (...args: Parameters<typeof storage.upload>) => {
          uploadAttempts.push(args[0]);
          await beforeUpload?.();
          if (uploadMode === "before-accept") throw new Error("storage write failed before acceptance");
          if (uploadMode === "definitive-reject") {
            return { data: null, error: { message: "request rejected before write", statusCode: "413" } } as Awaited<ReturnType<typeof storage.upload>>;
          }
          const result = await upload(...args);
          if (uploadMode === "after-accept") throw new Error("storage response lost after acceptance");
          return result;
        },
      });
    });
  });

  async function pendingVideo() {
    const signed = await signUpload(admin, {
      businessId: BUSINESS,
      userId: "22222222-2222-4222-8222-222222222222",
      mime: "video/mp4",
      bytes: VIDEO.length,
      sha256: sha256(VIDEO),
      width: 720,
      height: 1280,
      durationMs: 2000,
      rightsConfirmedAt: "2026-11-02T10:00:00.000Z",
    });
    if (signed.duplicate) throw new Error("unexpected duplicate");
    db.objects.set(signed.path, VIDEO);
    return { signed, row: db.tables.media_assets[0] as MediaRow };
  }

  it("reconciles an accepted final write after the asset/slot completion response is lost", async () => {
    const { signed, row } = await pendingVideo();
    failNextComplete = true;

    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({
      status: 409,
      code: "MEDIA_RECONCILIATION_REQUIRED",
    });
    const firstAttempt = states.get(signed.id);
    expect(firstAttempt).toMatchObject({ status: "writing", expected_bytes: expect.any(Number), expected_sha256: expect.any(String) });
    if (firstAttempt?.status !== "writing") throw new Error("missing pinned finalization attempt");
    expect(db.objects.has(firstAttempt.final_path)).toBe(true);

    const result = await finalizeUpload(admin, row);
    expect(result.id).toBe(signed.id);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", path: firstAttempt.final_path });
    expect(db.storageCalls.filter((call) => call.op === "upload").map((call) => call.path)).toEqual([firstAttempt.final_path]);
    expect(states.get(signed.id)).toEqual({ status: "ready", final_path: firstAttempt.final_path });
    expect(completedAttempts).toEqual([firstAttempt.attempt_id, firstAttempt.attempt_id]);
  });

  it("keeps reservations unresolved after a write fails before Storage accepts the object", async () => {
    const { signed, row } = await pendingVideo();
    uploadMode = "before-accept";

    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ code: "MEDIA_RECONCILIATION_REQUIRED" });
    const attempt = states.get(signed.id);
    expect(attempt).toMatchObject({ status: "writing" });
    if (attempt?.status !== "writing") throw new Error("missing pinned finalization attempt");
    expect(db.objects.has(attempt.final_path)).toBe(false);

    uploadMode = null;
    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ code: "MEDIA_RECONCILIATION_REQUIRED" });
    expect(uploadAttempts).toEqual([attempt.final_path]);
    expect(terminalAttempts).toEqual([]);
    expect(states.get(signed.id)).toMatchObject({ status: "writing", final_path: attempt.final_path });
    expect(db.tables.media_assets[0]).toMatchObject({ status: "pending", path: signed.path });
  });

  it("releases a fenced attempt only after a definitive pre-accept rejection", async () => {
    const { signed, row } = await pendingVideo();
    uploadMode = "definitive-reject";

    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ status: 503, code: "MEDIA_UNAVAILABLE" });
    const failedAttempt = states.get(signed.id);
    if (failedAttempt?.status !== "reserved") throw new Error("terminal failure did not release its attempt");
    expect(terminalAttempts).toEqual(["33333333-3333-4333-8333-333333333333"]);
    expect(db.objects.size).toBe(1);

    uploadMode = null;
    await expect(finalizeUpload(admin, row)).resolves.toMatchObject({ id: signed.id, kind: "video" });
    expect(uploadAttempts).toHaveLength(2);
    expect(uploadAttempts[0]).not.toBe(uploadAttempts[1]);
  });

  it("reconciles exact bytes when Storage accepts a write but its response is lost", async () => {
    const { signed, row } = await pendingVideo();
    uploadMode = "after-accept";

    await expect(finalizeUpload(admin, row)).resolves.toMatchObject({ id: signed.id, kind: "video" });
    const attempt = states.get(signed.id);
    expect(attempt?.status).toBe("ready");
    expect(uploadAttempts).toHaveLength(1);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", path: attempt?.status === "ready" ? attempt.final_path : "" });
  });

  it("preserves the pinned object and reservations when reconciliation finds different bytes", async () => {
    const { signed, row } = await pendingVideo();
    failNextComplete = true;
    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ code: "MEDIA_RECONCILIATION_REQUIRED" });
    const attempt = states.get(signed.id);
    if (attempt?.status !== "writing") throw new Error("missing pinned finalization attempt");
    const altered = Buffer.from(db.objects.get(attempt.final_path)!);
    altered[0] ^= 0xff;
    db.objects.set(attempt.final_path, altered);

    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ code: "MEDIA_RECONCILIATION_REQUIRED" });
    expect(db.objects.has(attempt.final_path)).toBe(true);
    expect(db.removed).not.toContain(attempt.final_path);
    expect(states.get(signed.id)).toMatchObject({ status: "writing", final_path: attempt.final_path });
    expect(db.tables.media_assets[0]).toMatchObject({ status: "pending", path: signed.path });
    expect(uploadAttempts).toEqual([attempt.final_path]);
  });

  it("does not start a second final write while the first attempt is still in flight", async () => {
    const { signed, row } = await pendingVideo();
    let release!: () => void;
    let started!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { started = resolve; });
    const uploadMayFinish = new Promise<void>((resolve) => { release = resolve; });
    beforeUpload = async () => { started(); await uploadMayFinish; };
    const first = finalizeUpload(admin, row);
    try {
      await uploadStarted;
      await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ code: "MEDIA_RECONCILIATION_REQUIRED" });
    } finally {
      release();
    }
    await expect(first).resolves.toMatchObject({ id: signed.id, kind: "video" });
    expect(uploadAttempts).toHaveLength(1);
    expect(db.storageCalls.filter((call) => call.op === "upload")).toHaveLength(1);
  });
});
