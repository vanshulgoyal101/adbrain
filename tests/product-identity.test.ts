import { describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { eventContext, newEventContext } from "@/lib/observability/context";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: mocks.getUser } }) }));

describe("verified logging identity", () => {
  it("captures the authenticated user without another auth request", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "owner" } }, error: null });
    const { createClient } = await import("@/lib/supabase/server");
    await eventContext.run(newEventContext(), async () => {
      const client = await createClient();
      expect((await client.auth.getUser()).data.user?.id).toBe("owner");
      expect(eventContext.getStore()?.userId).toBe("owner");
      expect(mocks.getUser).toHaveBeenCalledOnce();
    });
  });

  it("does not trust identity when authentication reports an error", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "unverified" } }, error: { message: "invalid token" } });
    const { createClient } = await import("@/lib/supabase/server");
    await eventContext.run(newEventContext(), async () => {
      await (await createClient()).auth.getUser();
      expect(eventContext.getStore()?.userId).toBeNull();
    });
  });
});

describe("workspace authentication recovery", () => {
  it("treats a missing or expired session as signed out", async () => {
    const { getUser } = await import("@/lib/supabase/queries");
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthSessionMissingError() });
    expect(await getUser()).toBeNull();
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthApiError("expired", 401, undefined) });
    expect(await getUser()).toBeNull();
  });

  it("surfaces an auth service failure without leaking provider details", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthApiError("private provider detail", 503, undefined) });
    const { getUser } = await import("@/lib/supabase/queries");
    await expect(getUser()).rejects.toThrow("Workspace sign-in could not be checked.");
  });
});