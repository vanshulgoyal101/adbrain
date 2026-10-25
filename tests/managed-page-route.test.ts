import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #523: the managed Page route. Off unless MANAGED_ACCOUNTS_ENABLED; only the signed-in user's own attempt.
const state = vi.hoisted(() => ({
  enabled: true,
  user: { id: "u1" } as { id: string } | null,
  attempts: {} as Record<string, { business_id: string; discovered_assets: unknown; user: string; expires_at: string }>,
  owners: {} as Record<string, string>,
  row: null as Record<string, unknown> | null,
  inserts: [] as { table: string; values: unknown }[],
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MANAGED_ACCOUNTS_ENABLED: state.enabled }) }));
vi.mock("@/lib/meta/pilot-access", () => ({ canUseMetaConnect: () => true }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: async (businessId: string) => {
    if (state.owners[businessId] !== state.user?.id) throw Object.assign(new Error("Business access is not allowed."), { code: "FORBIDDEN" });
    return { businessId, userId: state.user!.id };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (_name: string, args: { p_attempt_id: string; p_user_id: string }) => {
      const attempt = state.attempts[args.p_attempt_id];
      return { data: attempt && attempt.user === args.p_user_id ? [attempt] : [], error: null };
    },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
      insert: async (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        if (table === "managed_meta_accounts") state.row = { child_business_id: null, ...values };
        return { error: null };
      },
      update: (values: Record<string, unknown>) => ({ eq: async () => { state.row = { ...state.row, ...values }; return { error: null }; } }),
    }),
  }),
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const otherAttempt = "22222222-2222-4222-8222-222222222222";
const snapshot = { pages: [{ id: "111", name: "Solaride Mohali", tasks: ["MANAGE", "ADVERTISE"] }, { id: "222", name: "Not mine", tasks: ["ADVERTISE"] }] };
const post = (body: unknown) => new NextRequest("http://localhost/api/meta/managed/page", { method: "POST", body: JSON.stringify(body) });
const get = (id: string) => new NextRequest(`http://localhost/api/meta/managed/page?attemptId=${id}`);

beforeEach(() => {
  state.enabled = true;
  state.user = { id: "u1" };
  state.row = null;
  state.inserts = [];
  const later = new Date(Date.now() + 600_000).toISOString();
  state.attempts = {
    [attemptId]: { business_id: "b1", discovered_assets: snapshot, user: "u1", expires_at: later },
    [otherAttempt]: { business_id: "b2", discovered_assets: snapshot, user: "u2", expires_at: later },
  };
  state.owners = { b1: "u1", b2: "u2" };
});

describe("/api/meta/managed/page (#523)", () => {
  it("is off unless managed accounts are enabled", async () => {
    state.enabled = false;
    const { GET, POST } = await import("@/app/api/meta/managed/page/route");
    expect((await GET(get(attemptId))).status).toBe(404);
    expect((await POST(post({ attemptId, pageId: "111" }))).status).toBe(404);
    expect(state.inserts).toEqual([]);
  });

  it("lists only Pages the owner administers, with Meta's Page creator", async () => {
    const { GET } = await import("@/app/api/meta/managed/page/route");
    const body = await (await GET(get(attemptId))).json();
    expect(body.data).toEqual({ pages: [{ id: "111", name: "Solaride Mohali" }], createUrl: "https://www.facebook.com/pages/create/", linked: null });
  });

  it("can't see or use another user's connection attempt", async () => {
    const { GET, POST } = await import("@/app/api/meta/managed/page/route");
    expect((await GET(get(otherAttempt))).status).toBe(404);
    expect((await POST(post({ attemptId: otherAttempt, pageId: "111" }))).status).toBe(404);
    state.user = null;
    expect((await GET(get(attemptId))).status).toBe(401);
    expect(state.inserts).toEqual([]);
  });

  // QA (#537): an old attempt's Page rights may have been removed since, and businesses change hands.
  it("refuses an expired attempt, and an attempt for a business the caller no longer owns", async () => {
    const { GET, POST } = await import("@/app/api/meta/managed/page/route");
    state.attempts[attemptId].expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await POST(post({ attemptId, pageId: "111" }));
    expect(expired.status).toBe(410);
    expect((await expired.json()).error.code).toBe("ATTEMPT_EXPIRED");
    expect((await GET(get(attemptId))).status).toBe(410);
    state.attempts[attemptId].expires_at = new Date(Date.now() + 600_000).toISOString();
    state.owners.b1 = "someone-else";
    expect((await POST(post({ attemptId, pageId: "111" }))).status).toBe(404);
    expect((await GET(get(attemptId))).status).toBe(404);
    expect(state.inserts).toEqual([]);
  });

  it("links an admin Page to page_linked and refuses one the owner doesn't administer", async () => {
    const { POST } = await import("@/app/api/meta/managed/page/route");
    const refused = await POST(post({ attemptId, pageId: "222" }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("PAGE_NOT_ADMIN");
    const linked = await POST(post({ attemptId, pageId: "111" }));
    expect((await linked.json()).data).toEqual({ ok: true, state: "page_linked", pageId: "111" });
    expect(state.inserts).toEqual([
      { table: "managed_meta_accounts", values: { business_id: "b1", page_id: "111", state: "requested" } },
      { table: "managed_meta_account_events", values: expect.objectContaining({ business_id: "b1", step: "page", outcome: "succeeded", meta_object_id: "111" }) },
    ]);
  });
});
