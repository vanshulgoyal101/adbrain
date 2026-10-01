import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), insert: vi.fn(), update: vi.fn(), allowed: vi.fn(), limit: vi.fn() }));
const ownerId = "11111111-1111-4111-8111-111111111111";
const row = { id: "22222222-2222-4222-8222-222222222222", owner_id: ownerId, kind: "export", status: "received",
  created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: () => ({
  select: () => ({ eq: () => ({ order: () => ({ limit: mocks.list }) }) }),
  insert: mocks.insert,
}) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: mocks.allowed, from: () => ({ select: () => ({ in: () => ({ order: () => ({ limit: mocks.list }) }) }), update: mocks.update }),
}) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.limit }));

const submission = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/privacy-requests", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const statusChange = (body: unknown) => new Request("http://localhost/api/privacy-requests/operator", {
  method: "PATCH", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: ownerId } } });
  mocks.list.mockResolvedValue({ data: [row], error: null });
  mocks.limit.mockResolvedValue(null);
  mocks.allowed.mockResolvedValue({ data: false, error: null });
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: row, error: null }) }) });
  mocks.update.mockReturnValue({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) });
});

describe("privacy request routes", () => {
  it("does not render the operator page or read the queue without a private operator grant", async () => {
    const { default: OperatorPage } = await import("@/app/(app)/settings/privacy-requests/page");
    await expect(OperatorPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    await expect(OperatorPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(mocks.allowed).toHaveBeenCalledTimes(1);
    mocks.allowed.mockResolvedValue({ data: true, error: null });
    const page = await OperatorPage();
    expect(page.props.children.at(-1).type.name).toBe("PrivacyOperatorQueue");
  });

  it("requires a session before storage or an operator check", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    const customer = await import("@/app/api/privacy-requests/route");
    const operator = await import("@/app/api/privacy-requests/operator/route");
    expect((await customer.GET()).status).toBe(401);
    expect((await customer.POST(submission({ kind: "export" }))).status).toBe(401);
    expect((await operator.GET(new Request("http://localhost/api/privacy-requests/operator"))).status).toBe(401);
    expect((await operator.PATCH(statusChange({ id: row.id, expectedStatus: "received", status: "in_review" }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.allowed).not.toHaveBeenCalled();
  });

  it("shows only the signed-in owner their requests and submits an explicit type", async () => {
    const { GET, POST } = await import("@/app/api/privacy-requests/route");
    const list = await GET();
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(await list.json()).toEqual({ requests: [row] });
    const created = await POST(submission({ kind: "export" }));
    expect(created.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith({ owner_id: ownerId, kind: "export" });
  });

  it("rejects cross-origin, extra fields and duplicate or unavailable storage", async () => {
    const { POST, GET } = await import("@/app/api/privacy-requests/route");
    expect((await POST(submission({ kind: "delete" }, "https://foreign.example"))).status).toBe(403);
    expect((await POST(submission({ kind: "delete", owner_id: row.id }))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
    mocks.insert.mockReturnValueOnce({ select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) });
    expect((await POST(submission({ kind: "delete" }))).status).toBe(409);
    mocks.list.mockResolvedValueOnce({ data: null, error: { code: "PGRST" } });
    expect((await GET()).status).toBe(503);
  });

  it("denies an ordinary customer before queue access or status changes", async () => {
    const { GET, PATCH } = await import("@/app/api/privacy-requests/operator/route");
    expect((await GET(new Request("http://localhost/api/privacy-requests/operator?check=1"))).status).toBe(403);
    expect((await PATCH(statusChange({ id: row.id, expectedStatus: "received", status: "completed" }))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets an approved operator view the queue and advance only a matching status", async () => {
    mocks.allowed.mockResolvedValue({ data: true, error: null });
    const { GET, PATCH } = await import("@/app/api/privacy-requests/operator/route");
    expect(await (await GET(new Request("http://localhost/api/privacy-requests/operator?check=1"))).json()).toEqual({ allowed: true });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(await (await GET(new Request("http://localhost/api/privacy-requests/operator"))).json()).toEqual({ requests: [row] });
    const response = await PATCH(statusChange({ id: row.id, expectedStatus: "received", status: "in_review" }));
    expect(response.status).toBe(200);
    expect(mocks.allowed).toHaveBeenCalledWith("privacy_request_operator_allowed", { p_user_id: ownerId });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ handled_by: ownerId, status: "in_review" }));
  });
});