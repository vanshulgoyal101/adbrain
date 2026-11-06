import { beforeEach, describe, expect, it, vi } from "vitest";
import { SMOKE_FENCE_HEADER } from "@/lib/security/smoke-fence";

const h = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  rpc: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => h.requestHeaders }));
vi.mock("@/lib/observability/logger", () => ({
  observeAction: (_name: string, action: () => unknown) => action(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: h.rpc }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ ALERTS_WHATSAPP: "919876543210" }),
}));

const businessId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.requestHeaders = new Headers();
  h.rpc.mockImplementation(async (name: string) => ({
    data: name === "owner_alert_prefs_set"
      ? { lead_alerts: true, daily_results: false, language: "en", phone_e164: null, verified_at: null, opted_out_at: null }
      : "123456",
    error: null,
  }));
});

describe("draft-only smoke fence for WhatsApp alert actions", () => {
  it.each([
    ["saving alert settings", async () => {
      const { saveAlertSettings } = await import("@/app/(app)/settings/whatsapp-alerts-actions");
      return saveAlertSettings({ businessId, leadAlerts: true, dailyResults: false, language: "en" });
    }],
    ["starting alert verification", async () => {
      const { startAlertVerification } = await import("@/app/(app)/settings/whatsapp-alerts-actions");
      return startAlertVerification({ businessId });
    }],
  ])("blocks %s before any RPC call", async (_name, run) => {
    h.requestHeaders = new Headers({ [SMOKE_FENCE_HEADER]: "draft-only" });

    const result = await run();

    expect(result.ok).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
