import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyMetaCapabilities } from "@/lib/meta/capability-verification";

// #1696 (before Meta's 'Require app secret'): Connect's capability check must send appsecret_proof on every read,
// with the proof made from the token that read uses, or verification fails once the owner turns the setting on.
const selected = { adAccountId: "act_1", pageId: "page_1", accountName: "A", pageName: "P", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
const proofOf = (token: string) => createHmac("sha256", "app-secret").update(token).digest("hex");

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function answer() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/permissions")) return Response.json({ data: [{ permission: "ads_management", status: "granted" }, { permission: "ads_read", status: "granted" }, { permission: "leads_retrieval", status: "granted" }, { permission: "pages_show_list", status: "granted" }, { permission: "pages_read_engagement", status: "granted" }, { permission: "pages_manage_ads", status: "granted" }, { permission: "business_management", status: "granted" }] });
    if (path.endsWith("/accounts")) return Response.json({ data: [{ id: "page_1", tasks: ["ADVERTISE", "MANAGE"] }] });
    if (path.endsWith("/page_1")) return Response.json({ access_token: "page-token" });
    return Response.json({ data: [], id: "act_1", account_status: 1 });
  });
}

describe("capability verification sends appsecret_proof (#1696)", () => {
  it("adds the proof for the token each read uses, and keeps the token out of the URL", async () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");
    const fetchSpy = answer();
    await verifyMetaCapabilities("user-token", selected).catch(() => undefined);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    for (const [input, init] of fetchSpy.mock.calls) {
      const url = new URL(String(input));
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      expect(url.searchParams.get("appsecret_proof")).toBe(proofOf(token));
      expect(String(input)).not.toContain(token);
    }
  });

  it("sends no proof when no app secret is configured", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const fetchSpy = answer();
    await verifyMetaCapabilities("user-token", selected).catch(() => undefined);
    for (const [input] of fetchSpy.mock.calls) expect(String(input)).not.toContain("appsecret_proof");
  });
});
