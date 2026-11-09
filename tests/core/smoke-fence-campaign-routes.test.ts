import { describe, expect, it, vi } from "vitest";
import { SMOKE_FENCE_HEADER } from "@/lib/security/smoke-fence";

const database = vi.hoisted(() => ({
  createClient: vi.fn(async () => {
    throw new Error("A fenced campaign route reached Supabase.");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: database.createClient }));

const fencedRequest = (url: string, method: string) => new Request(`http://localhost${url}`, {
  method,
  headers: { [SMOKE_FENCE_HEADER]: "draft-only" },
});
const context = <T extends { id: string }>(params: T) => ({ params: Promise.resolve(params) });

const routes = [
  ["campaign budget", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/budget/route");
    return POST(fencedRequest("/api/campaigns/c1/budget", "POST"), context({ id: "c1" }));
  }],
  ["campaign audience edit", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/audience/route");
    return POST(fencedRequest("/api/campaigns/c1/audience", "POST"), context({ id: "c1" }));
  }],
  ["campaign audience switch", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/audience/switch/route");
    return POST(fencedRequest("/api/campaigns/c1/audience/switch", "POST"), context({ id: "c1" }));
  }],
  ["ad copy edit", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/ads/[adId]/route");
    return PATCH(fencedRequest("/api/campaigns/c1/ads/1001", "PATCH"), context({ id: "c1", adId: "1001" }));
  }],
  ["ad delivery edit", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/ads/[adId]/status/route");
    return POST(fencedRequest("/api/campaigns/c1/ads/1001/status", "POST"), context({ id: "c1", adId: "1001" }));
  }],
  ["campaign refresh", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    return POST(fencedRequest("/api/campaigns/c1/refresh", "POST"), context({ id: "c1" }));
  }],
  ["manual enquiry create", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/enquiries/route");
    return POST(fencedRequest("/api/campaigns/c1/enquiries", "POST"), context({ id: "c1" }));
  }],
  ["manual enquiry delete", async () => {
    const { DELETE } = await import("@/app/api/campaigns/[id]/enquiries/route");
    return DELETE(fencedRequest("/api/campaigns/c1/enquiries?lead=l1", "DELETE"), context({ id: "c1" }));
  }],
] as const;

describe("core: draft-only smoke fences campaign mutations at the route boundary", () => {
  it.each(routes)("refuses %s before server-side effects", async (_name, invoke) => {
    database.createClient.mockClear();
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SMOKE_FENCE", effect: "campaign_write" },
    });
    expect(database.createClient).not.toHaveBeenCalled();
  });
});
