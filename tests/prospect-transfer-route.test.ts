import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1700 (QA red test for #1670): only a `+prospect` staff session can start handing a business to its owner. A customer
// or a non-prospect team login gets a 4xx, and nothing is created or emailed: no `business_transfer_start`, no invite
// or magic link. Control: a `+prospect` session does reach the RPC. Skips until the route exists; contract path below.
const ROUTE = "src/app/api/prospect/transfer/route.ts";
const built = existsSync(join(process.cwd(), ROUTE));

const m = vi.hoisted(() => ({ user: null as null | { id: string; email: string; email_confirmed_at: string }, rpc: vi.fn(), adminAuth: vi.fn() }));
const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "", name: "Prospect bakery" };
const chain = (): Record<string, unknown> => new Proxy({}, {
  get: (_target, key) => key === "then" ? undefined
    : ["maybeSingle", "single"].includes(String(key)) ? async () => ({ data: { ...business, owner_id: m.user?.id }, error: null })
      : () => chain(),
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user }, error: null }) }, from: () => chain(), rpc: m.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => chain(),
    rpc: async (name: string, args: unknown) => { m.rpc(name, args); return { data: "22222222-2222-4222-8222-222222222222", error: null }; },
    auth: { admin: new Proxy({}, { get: (_t, key) => async (...args: unknown[]) => { m.adminAuth(String(key), ...args); return { data: { properties: { action_link: "https://x" } }, error: null }; } }) },
  }),
}));

async function post(email: string) {
  m.user = { id: "33333333-3333-4333-8333-333333333333", email, email_confirmed_at: "2026-10-28T00:00:00Z" };
  const { POST } = await import(/* @vite-ignore */ join(process.cwd(), ROUTE));
  return POST(new Request("https://adbrain.vanshul.com/api/prospect/transfer", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId: business.id, ownerEmail: "owner@example.com" }),
  })) as Promise<Response>;
}
const started = () => m.rpc.mock.calls.some(([name]) => name === "business_transfer_start");

beforeEach(() => { vi.clearAllMocks(); m.user = null; });

describe.skipIf(!built)("prospect hand-over route: only a +prospect session can start one (#1700, #1670)", () => {
  it.each(["owner@example.com", "qa@adbrain.vanshul.com"])("%s gets a 4xx; nothing is created or emailed", async (email) => {
    const response = await post(email);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(started()).toBe(false);
    expect(m.adminAuth).not.toHaveBeenCalled();
  });

  it("control: a +prospect session reaches the transfer RPC", async () => {
    await post("qa+prospect-bio2@adbrain.vanshul.com");
    expect(started()).toBe(true);
  });
});

