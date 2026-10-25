import { beforeEach, describe, expect, it, vi } from "vitest";
import { startSelectionChange } from "@/lib/meta/change-selection";

const m = vi.hoisted(() => ({
  status: vi.fn(),
  row: { data: null as unknown, error: null as unknown },
  create: vi.fn(), discovering: vi.fn(), attach: vi.fn(), discover: vi.fn(),
}));
vi.mock("@/lib/meta/connection-access", () => ({ getConnectionStatus: m.status }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => m.row }) }) }) }),
}));
vi.mock("@/lib/meta/connection-repository", () => ({
  createBrowserBinding: () => "binding",
  createConnectionAttempt: m.create,
  markAttemptDiscovering: m.discovering,
  attachAttemptToken: m.attach,
  getConnectionAttempt: vi.fn(),
}));
vi.mock("@/lib/meta/retry-discovery", () => ({ runAttemptDiscovery: m.discover }));

const business = { businessId: "b-1", userId: "u-1" } as never;
const connected = { authorization: "connected", selected: { pageId: "p" }, generation: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  m.status.mockResolvedValue(connected);
  m.row = { data: { token_id: "tok-1", generation: 7 }, error: null };
  m.create.mockResolvedValue({ attemptId: "att-1", expiresAt: "x" });
  m.discover.mockResolvedValue({ attemptId: "att-1", state: "selection_required" });
});

describe("Change reuses the saved Facebook grant (#474)", () => {
  it("opens an attempt on the saved token and discovers its Pages and ad accounts", async () => {
    await expect(startSelectionChange(business, { kind: "setup" })).resolves.toMatchObject({ state: "selection_required" });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b-1", userId: "u-1", intent: { kind: "setup" }, expectedGeneration: 7 }));
    expect(m.discovering).toHaveBeenCalledWith("att-1");
    expect(m.attach).toHaveBeenCalledWith("att-1", "tok-1");
    expect(m.discover).toHaveBeenCalledWith("att-1", "u-1");
    // Ordering matters: the token can only be attached once the attempt is discovering.
    expect(m.discovering.mock.invocationCallOrder[0]).toBeLessThan(m.attach.mock.invocationCallOrder[0]);
  });

  it.each([
    ["not connected", () => m.status.mockResolvedValue({ ...connected, authorization: "disconnected", selected: null })],
    ["no saved token", () => { m.row = { data: { token_id: null, generation: 7 }, error: null }; }],
    ["connection changed meanwhile", () => { m.row = { data: { token_id: "tok-1", generation: 8 }, error: null }; }],
    ["database error", () => { m.row = { data: null, error: new Error("down") }; }],
  ])("returns null with no attempt when %s", async (_name, arrange) => {
    arrange();
    await expect(startSelectionChange(business, { kind: "setup" })).resolves.toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });
});
