import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tape from "./fixtures/meta/revoke-permissions.json";
import type { ProductEventInput } from "@/lib/observability/events";

// #1649 (#1648, CTO): on disconnect, revoke the app's grant at Meta for that person, best effort, and only when it
// can't cut off anyone else: never for a business system user, never when the same Meta user still connects another
// business, never for the smoke account (#1324). Nothing here can block the disconnect.
const h = vi.hoisted(() => ({
  target: [] as unknown[], targetError: null as null | { code: string }, owner: "55555555-5555-4555-8555-555555555555",
  events: [] as ProductEventInput[],
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string) => name === "meta_token_revocation_target"
    ? { data: h.targetError ? null : h.target, error: h.targetError }
    : { data: [{ id: "token-1", business_id: "biz", ciphertext: "c", nonce: "n", auth_tag: "t", key_id: "k", format_version: "v1", expires_at: null, revoked_at: null }], error: null },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: h.owner, ad_account_id: "act_1", page_id: "page_1" }, error: null }) }) }) }),
}) }));
vi.mock("@/lib/meta/token-store", () => ({ decryptMetaToken: () => "user-token", fromPostgresBytea: (value: string) => value }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: (event: ProductEventInput) => h.events.push(event) }));

const userTarget = { token_id: "token-1", subject_id: tape.subjectId, token_kind: "user", shared: false };
const meta = (answer: { status: number; body: unknown }) => vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(answer.body, { status: answer.status }));

beforeEach(() => { h.target = [userTarget]; h.targetError = null; h.owner = "55555555-5555-4555-8555-555555555555"; h.events = []; });
afterEach(() => vi.restoreAllMocks());

describe("core: revoke the Meta grant on disconnect (#1649)", () => {
  it("revokes a user token's grant with one DELETE, token in the header", async () => {
    const fetchSpy = meta(tape.revoked);
    const { revokeMetaGrant } = await import("@/lib/meta/revoke-grant");
    expect(await revokeMetaGrant("biz")).toBe("revoked");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [input, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(new URL(String(input)).pathname).toMatch(new RegExp(`/${tape.subjectId}/permissions$`));
    expect(String(input)).not.toContain("user-token");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-token");
    expect(h.events).toContainEqual(expect.objectContaining({ name: "meta.revoke", outcome: "success" }));
  });

  it("treats Meta's 'not authorized' (190) as already revoked", async () => {
    meta(tape.alreadyRevoked);
    const { revokeMetaGrant } = await import("@/lib/meta/revoke-grant");
    expect(await revokeMetaGrant("biz")).toBe("already");
  });

  it.each([
    ["the same Meta user still connects another business", { ...userTarget, shared: true }, "skipped_shared"],
    ["a business system-user token", { ...userTarget, token_kind: "business_system_user" }, "skipped_system"],
  ] as const)("skips %s, with no Meta call", async (_label, target, outcome) => {
    const fetchSpy = meta(tape.revoked);
    h.target = [target];
    const { revokeMetaGrant } = await import("@/lib/meta/revoke-grant");
    expect(await revokeMetaGrant("biz")).toBe(outcome);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never revokes for the smoke account (pause-only, #1324)", async () => {
    const fetchSpy = meta(tape.revoked);
    h.owner = "144e4745-7e6d-4fb9-a1fd-7edec31a335f";
    const { revokeMetaGrant } = await import("@/lib/meta/revoke-grant");
    expect(await revokeMetaGrant("biz")).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips quietly until the lookup exists, and never throws on a failure", async () => {
    const fetchSpy = meta(tape.revoked);
    h.targetError = { code: "PGRST202" };
    const { revokeMetaGrant } = await import("@/lib/meta/revoke-grant");
    expect(await revokeMetaGrant("biz")).toBe("unavailable");
    h.targetError = null;
    h.target = [];
    expect(await revokeMetaGrant("biz")).toBe("skipped_none");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    h.target = [userTarget];
    expect(await revokeMetaGrant("biz")).toBe("failed");
    expect(JSON.stringify(h.events)).not.toContain("user-token");
  });
});
