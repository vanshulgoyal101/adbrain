import { afterEach, describe, expect, it, vi } from "vitest";
import internal from "@/lib/internal-accounts.json";
import { metaWriteMode } from "@/lib/internal-accounts";
import { ConnectionAccessError } from "@/lib/meta/connection-access-error";
import { MetaClient } from "@/lib/meta/client";

// #1324: the smoke/demo login is connected to the real Solaride ad account. Automated walks on it may read,
// validate and pause there, but nothing they do can create, activate, edit or delete on Meta.
const creds = { adAccountId: "act_900000000000001", pageId: "900000000000002", accessToken: "fake-token" };
const smokeOwner = internal.smokeUserIds[0];

function mockGraph() {
  const fetchMock = vi.fn(async () => Response.json({ id: "900000000000003", success: true }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("smoke account Meta write guard (#1324)", () => {
  it("is pause-only for a smoke-owned business on any ad account that isn't a listed test account", () => {
    expect(metaWriteMode(smokeOwner, "act_900000000000001")).toBe("pause-only");
    expect(metaWriteMode(smokeOwner, null)).toBe("pause-only");
    expect(metaWriteMode("00000000-0000-4000-8000-000000000001", "act_900000000000001")).toBe("all");
  });

  it("lets reads, validate_only checks and pauses through", async () => {
    const fetchMock = mockGraph();
    const meta = new MetaClient(creds, undefined, "pause-only") as unknown as { graph: (path: string, opts?: object) => Promise<unknown> };
    await meta.graph("900000000000003?fields=id,status");
    await meta.graph("act_900000000000001/ads", { method: "POST", form: { name: "x", execution_options: JSON.stringify(["validate_only"]) } });
    await meta.graph("900000000000003", { method: "POST", form: { status: "PAUSED" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["create", "act_900000000000001/campaigns", "POST", { name: "x", status: "PAUSED", objective: "OUTCOME_LEADS" }],
    ["activate", "900000000000003", "POST", { status: "ACTIVE" }],
    ["budget edit", "900000000000003", "POST", { daily_budget: "50000" }],
    ["image upload", "act_900000000000001/adimages", "POST", { bytes: "AAAA" }],
    ["delete", "900000000000003", "DELETE", undefined],
  ])("refuses a %s before it leaves the process", async (_name, path, method, form) => {
    const fetchMock = mockGraph();
    const meta = new MetaClient(creds, undefined, "pause-only") as unknown as { graph: (path: string, opts?: object) => Promise<unknown> };
    await expect(meta.graph(path, { method, form })).rejects.toBeInstanceOf(ConnectionAccessError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves every other business's client unchanged", async () => {
    const fetchMock = mockGraph();
    const meta = new MetaClient(creds) as unknown as { graph: (path: string, opts?: object) => Promise<unknown> };
    await meta.graph("act_900000000000001/campaigns", { method: "POST", form: { name: "x", status: "PAUSED" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
