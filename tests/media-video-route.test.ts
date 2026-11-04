import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/media-fake";

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof fakeSupabase> | null }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: true }) }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_route: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...state.db!.client,
    auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
  }),
}));

import { MEDIA_TERMS_VERSION } from "@/lib/media/consent";
import { POST as signRoute } from "@/app/api/media/sign/route";
import { POST as finalizeRoute } from "@/app/api/media/finalize/route";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const video = new Uint8Array(readFileSync("tests/fixtures/media/tall.mp4"));
const body = {
  businessId: BUSINESS, mime: "video/mp4", bytes: video.length,
  sha256: createHash("sha256").update(video).digest("hex"), width: 720, height: 1280, durationMs: 2000,
};
const request = (path: string, data: unknown) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});

beforeEach(() => {
  state.db = fakeSupabase();
  state.db.tables.businesses.push({ id: BUSINESS, owner_id: OWNER, transferred_at: null, vertical: null });
  state.db.tables.media_consents.push({
    business_id: BUSINESS, user_id: OWNER, terms_version: MEDIA_TERMS_VERSION,
    people_confirmed: false, confirmed_at: "2026-11-04T00:00:00.000Z",
  });
});

describe("video upload routes", () => {
  it("does not expose a signed token when its lifetime cannot be recorded", async () => {
    state.db!.rpcErrors.set("media_video_sign_finish", { message: "database unavailable" });
    const response = await signRoute(request("/api/media/sign", body));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(result).not.toHaveProperty("token");
    expect(state.db!.videoSlots.find((slot) => slot.slot === "upload")?.signingIntent).not.toBeNull();
  });

  it("returns a conflict without copying while a re-sign is in flight", async () => {
    const first = await signRoute(request("/api/media/sign", body));
    const signed = await first.json() as { id: string; path: string };
    expect(first.status).toBe(200);
    state.db!.objects.set(signed.path, video);
    let release!: () => void;
    let started!: () => void;
    const signingStarted = new Promise<void>((resolve) => { started = resolve; });
    const signingMayFinish = new Promise<void>((resolve) => { release = resolve; });
    state.db!.hooks.beforeSign = async () => { started(); await signingMayFinish; };
    const retry = signRoute(request("/api/media/sign", body));
    try {
      await signingStarted;
      state.db!.objects.set(signed.path, video);
      const response = await finalizeRoute(request("/api/media/finalize", { id: signed.id }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "MEDIA_FINALIZING" });
      expect(state.db!.storageCalls.filter((call) => call.op === "upload")).toHaveLength(0);
    } finally {
      release();
      await retry;
    }
  });
});
