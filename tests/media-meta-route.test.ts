import { beforeEach, describe, expect, it, vi } from "vitest";

// #749: the owner's file goes only to their business's own connected ad account, proven by the RLS read.
const m = vi.hoisted(() => ({
  own: vi.fn(), read: vi.fn(), client: vi.fn(), ensure: vi.fn(), port: vi.fn(),
}));
const admin = { admin: true };
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/media/store", () => ({ ownMedia: m.own, readVerifiedMedia: m.read }));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: m.client }));
vi.mock("@/services/meta-media", () => ({ ensureMetaMedia: m.ensure, metaMediaPort: m.port }));
vi.mock("@/lib/media/route-helpers", () => ({
  mediaSession: async () => ({ user: { id: "u1" }, client: { rls: true } }),
  mediaErrorResponse: (error: { status?: number }) => new Response(null, { status: error.status ?? 503 }),
}));

const ASSET = "44444444-4444-4444-8444-444444444444";
const BUSINESS = "11111111-1111-4111-8111-111111111111";
const row = { id: ASSET, business_id: BUSINESS, path: `${BUSINESS}/clip.mp4`, status: "ready" };
const post = async (payload: unknown = {}) => {
  const { POST } = await import("@/app/api/media/[id]/meta/route");
  const req = new Request(`https://adbrain.vanshul.com/api/media/${ASSET}/meta`, { method: "POST", body: JSON.stringify(payload) });
  return POST(req, { params: Promise.resolve({ id: ASSET }) }) as Promise<Response>;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.own.mockResolvedValue(row);
  m.client.mockResolvedValue({ adAccountId: "act_1" });
  m.port.mockReturnValue({ adAccountId: "act_1" });
  m.ensure.mockResolvedValue({ status: "processing", kind: "video", videoId: "9000000000000002" });
});

describe("POST /api/media/[id]/meta (#749)", () => {
  it("uses the RLS-read row's business and its own Meta connection, and reports processing", async () => {
    const response = await post({ retry: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "processing", kind: "video", videoId: "9000000000000002" });
    expect(m.own).toHaveBeenCalledWith({ rls: true }, ASSET);
    expect(m.client).toHaveBeenCalledWith(BUSINESS);
    expect(m.port).toHaveBeenCalledWith({ adAccountId: "act_1" });
    const [deps, input] = m.ensure.mock.calls[0];
    expect(input).toEqual({ businessId: BUSINESS, assetId: ASSET, retry: true });
    await deps.readBytes();
    expect(m.read).toHaveBeenCalledWith(admin, row);
  });

  it("refuses a request that names a business or account: only the file id counts", async () => {
    expect((await post({ businessId: "22222222-2222-4222-8222-222222222222" })).status).toBe(400);
    expect((await post({ adAccountId: "act_2" })).status).toBe(400);
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("refuses malformed JSON before any Meta upload", async () => {
    const { POST } = await import("@/app/api/media/[id]/meta/route");
    const req = new Request(`https://adbrain.vanshul.com/api/media/${ASSET}/meta`, { method: "POST", body: '{"retry":' });
    const response = await POST(req, { params: Promise.resolve({ id: ASSET }) });
    expect({ status: response.status, uploads: m.ensure.mock.calls.length }).toEqual({ status: 400, uploads: 0 });
  });

  it("an empty body is a plain status call", async () => {
    const { POST } = await import("@/app/api/media/[id]/meta/route");
    const response = await POST(new Request(`https://adbrain.vanshul.com/api/media/${ASSET}/meta`, { method: "POST" }), { params: Promise.resolve({ id: ASSET }) });
    expect(response.status).toBe(200);
    expect(m.ensure.mock.calls[0][1]).toEqual({ businessId: BUSINESS, assetId: ASSET, retry: undefined });
  });

  it("another owner's file is not found through RLS, so nothing reaches Meta", async () => {
    m.own.mockRejectedValue(Object.assign(new Error("Photo not found."), { status: 404 }));
    expect((await post()).status).toBe(404);
    expect(m.client).not.toHaveBeenCalled();
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("without a Meta connection: 409 META_NOT_CONNECTED, no upload", async () => {
    m.client.mockResolvedValue(null);
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("META_NOT_CONNECTED");
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("maps the service's refusals and passes its plain-words errors through", async () => {
    m.ensure.mockResolvedValueOnce({ status: "refused", reason: "not_ready" });
    const notReady = await post();
    expect(notReady.status).toBe(409);
    expect((await notReady.json()).code).toBe("MEDIA_NOT_UPLOADED");

    m.ensure.mockResolvedValueOnce({ status: "refused", reason: "bad_account" });
    expect((await (await post()).json()).code).toBe("META_NOT_CONNECTED");

    const problem = { kind: "format", message: "Meta can't use this file type." };
    m.ensure.mockResolvedValueOnce({ status: "error", kind: "video", problem });
    const failed = await post();
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ ok: true, status: "error", kind: "video", problem });
  });

  it("the pause-only smoke account is told plainly it can't send, not to try again", async () => {
    m.ensure.mockResolvedValueOnce({ status: "refused", reason: "read_only" });
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("META_READ_ONLY");
  });
});
