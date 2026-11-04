// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import type { AdInstruction, BrandAsset, Business } from "@/lib/types";
import type { MetaConnection } from "@/lib/meta/credentials";
import BrandPage from "@/app/(app)/brand/page";

const reads = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(),
  hasLaunchedCampaign: vi.fn(),
  getBrandAssets: vi.fn(),
  getAdInstructions: vi.fn(),
  getMetaConnection: vi.fn(),
  requestWords: vi.fn(),
  setupWords: vi.fn(),
  localeChosen: vi.fn(),
  readWhatsAppStatus: vi.fn(),
}));

vi.mock("@/lib/supabase/queries", () => reads);
vi.mock("@/lib/meta/credentials", () => ({ getMetaConnection: reads.getMetaConnection }));
vi.mock("@/lib/meta/whatsapp-status", () => ({ readWhatsAppStatus: reads.readWhatsAppStatus }));
vi.mock("@/i18n/request-locale", () => ({
  requestWords: reads.requestWords,
  setupWords: reads.setupWords,
  localeChosen: reads.localeChosen,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/internal-accounts", () => ({ isInternalUser: () => false }));
vi.mock("@/components/setup-business-step", () => ({
  SetupBusinessStep: ({ business, returning, chooseLanguage }: {
    business: Business | null;
    returning?: boolean;
    chooseLanguage?: boolean;
  }) => <p>{returning ? "Returning setup" : "First setup"}: {business?.name ?? "new business"}; choose language: {String(chooseLanguage)}</p>,
}));
vi.mock("@/components/brand-form", () => ({
  BrandForm: ({ business, photoCount }: { business: Business | null; photoCount: number }) =>
    <p>{business?.name ?? "New business"}: {photoCount} photos</p>,
}));
vi.mock("@/components/brand-assets", () => ({
  BrandAssets: ({ initialAssets }: { initialAssets: BrandAsset[] }) => <p>Assets: {initialAssets.length}</p>,
}));
vi.mock("@/components/instructions", () => ({
  Instructions: ({ instructions }: { instructions: AdInstruction[] }) => <p>Instructions: {instructions[0]?.title}</p>,
}));
vi.mock("@/components/whatsapp-message-card", () => ({
  WhatsAppMessageCard: ({ words }: { words?: { locale: string } }) => <p>Message language: {words?.locale}</p>,
}));

const business: Business = {
  id: "business-1", owner_id: "owner-1", name: "SunPeak", vertical: "solar energy",
  website: null, description: null, brand_voice: null, primary_color: null, secondary_color: null,
  font: null, languages: ["English"], locations: ["Jaipur"], target_audience: null,
  usps: [], offers: ["Free survey"], logo_url: null, phone: null, email: null,
  whatsapp_template: null, address: null, created_at: "2026-01-01", updated_at: "2026-01-01",
};
const assets: BrandAsset[] = [
  { id: "photo", business_id: business.id, type: "product_photo", url: "https://example.test/photo", notes: null, created_at: "2026-01-01" },
  { id: "logo", business_id: business.id, type: "logo", url: "https://example.test/logo", notes: null, created_at: "2026-01-01" },
];
const instructions: AdInstruction[] = [{
  id: "instruction", business_id: business.id, title: "Keep it clear", content: "Be clear.",
  is_active: true, created_at: "2026-01-01", updated_at: "2026-01-01",
}];
const connection: MetaConnection = {
  source: "oauth", pending: false, ready: true, adAccountId: "account", pageId: "page",
  tokenExpiresAt: null, expired: false, scopes: [],
};
const whatsappWords = { locale: "en", messages: en.whatsappMessage };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function delay<T>(value: T, ms: number) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
}

function brandPage(params: { all?: string; again?: string } = {}) {
  return BrandPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reads.getPrimaryBusiness.mockResolvedValue(business);
  reads.hasLaunchedCampaign.mockResolvedValue(true);
  reads.getBrandAssets.mockResolvedValue(assets);
  reads.getAdInstructions.mockResolvedValue(instructions);
  reads.getMetaConnection.mockResolvedValue(connection);
  reads.requestWords.mockResolvedValue(whatsappWords);
  reads.setupWords.mockResolvedValue({ locale: "en", messages: en.setup });
  reads.localeChosen.mockResolvedValue(false);
  reads.readWhatsAppStatus.mockResolvedValue({ state: "unavailable" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("core: Brand page read concurrency (#2849)", () => {
  it("starts the WhatsApp language read while the business lookup is pending", async () => {
    const lookup = deferred<Business | null>();
    reads.getPrimaryBusiness.mockReturnValue(lookup.promise);
    const page = brandPage();
    try {
      expect(reads.getPrimaryBusiness).toHaveBeenCalled();
      expect(reads.requestWords).toHaveBeenCalledWith("whatsappMessage");
    } finally {
      lookup.resolve(business);
      await page;
    }
  });

  it("starts all business-scoped reads before the launch check finishes", async () => {
    const launch = deferred<boolean>();
    const launchStarted = deferred<void>();
    reads.hasLaunchedCampaign.mockImplementation(() => {
      launchStarted.resolve();
      return launch.promise;
    });
    const page = brandPage();
    try {
      await launchStarted.promise;
      expect(reads.hasLaunchedCampaign).toHaveBeenCalledWith(business.id);
      expect(reads.getBrandAssets).toHaveBeenCalledWith(business.id);
      expect(reads.getAdInstructions).toHaveBeenCalledWith(business.id);
      expect(reads.getMetaConnection).toHaveBeenCalledWith(business.id);
    } finally {
      launch.resolve(true);
      await page;
    }
  });

  it("finishes overlapping synthetic reads within the 1.2-second budget", async () => {
    vi.useFakeTimers();
    reads.getPrimaryBusiness.mockImplementation(() => delay(business, 100));
    reads.hasLaunchedCampaign.mockImplementation(() => delay(true, 650));
    reads.getBrandAssets.mockImplementation(() => delay(assets, 700));
    reads.getAdInstructions.mockImplementation(() => delay(instructions, 400));
    reads.getMetaConnection.mockImplementation(() => delay(connection, 600));
    reads.requestWords.mockImplementation(() => delay(whatsappWords, 100));
    const start = Date.now();
    let elapsed = Infinity;
    const page = brandPage();
    void page.then(() => { elapsed = Date.now() - start; }, () => {});
    try {
      await vi.advanceTimersByTimeAsync(1199);
      expect(elapsed).toBeLessThan(1200);
    } finally {
      await vi.runAllTimersAsync();
      await page;
    }
  });

  it("renders a first-timer's setup without waiting for speculative reads", async () => {
    const pendingAssets = deferred<BrandAsset[]>();
    reads.getBrandAssets.mockReturnValue(pendingAssets.promise);
    reads.hasLaunchedCampaign.mockResolvedValue(false);
    const page = brandPage();
    let settled = false;
    void page.then(() => { settled = true; }, () => {});
    try {
      await waitFor(() => expect(settled).toBe(true));
      render(await page);
      expect(screen.getByText("First setup: SunPeak; choose language: true")).toBeInTheDocument();
    } finally {
      pendingAssets.resolve(assets);
      await page;
    }
  });

  it("reports a speculative read failure without blocking first-time setup", async () => {
    const launch = deferred<boolean>();
    reads.hasLaunchedCampaign.mockReturnValue(launch.promise);
    reads.getAdInstructions.mockRejectedValue(new Error("Ad instructions could not be loaded."));
    const page = brandPage();
    try {
      await waitFor(() => expect(reads.hasLaunchedCampaign).toHaveBeenCalled());
      await waitFor(() => expect(console.error).toHaveBeenCalled());
    } finally {
      launch.resolve(false);
    }
    render(await page);
    expect(screen.getByText("First setup: SunPeak; choose language: true")).toBeInTheDocument();
  });

  it("reports a speculative failure that arrives after setup has rendered", async () => {
    const pendingAssets = deferred<BrandAsset[]>();
    reads.getBrandAssets.mockReturnValue(pendingAssets.promise);
    reads.hasLaunchedCampaign.mockResolvedValue(false);
    render(await brandPage());
    pendingAssets.reject(new Error("Assets could not be loaded."));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("[brand.data]", "Assets could not be loaded."));
    expect(screen.getByText("First setup: SunPeak; choose language: true")).toBeInTheDocument();
  });

  it("keeps the full page's data, WhatsApp language, and photo count", async () => {
    reads.requestWords.mockResolvedValue({ locale: "hi", messages: hi.whatsappMessage });
    render(await brandPage());
    expect(screen.getByText("SunPeak: 1 photos")).toBeInTheDocument();
    expect(screen.getByText("Assets: 2")).toBeInTheDocument();
    expect(screen.getByText("Instructions: Keep it clear")).toBeInTheDocument();
    expect(screen.getByText("Message language: hi")).toBeInTheDocument();
    expect(reads.readWhatsAppStatus).toHaveBeenCalledWith(business.id);
  });

  it("keeps the returning setup path and does not fetch full-page data", async () => {
    render(await brandPage({ again: "1" }));
    expect(screen.getByText("Returning setup: SunPeak; choose language: undefined")).toBeInTheDocument();
    expect(reads.getBrandAssets).not.toHaveBeenCalled();
    expect(reads.getAdInstructions).not.toHaveBeenCalled();
    expect(reads.getMetaConnection).not.toHaveBeenCalled();
  });

  it("keeps a first-timer on first setup even when again=1", async () => {
    reads.hasLaunchedCampaign.mockResolvedValue(false);
    render(await brandPage({ again: "1" }));
    expect(screen.getByText("First setup: SunPeak; choose language: true")).toBeInTheDocument();
  });

  it("opens the full page with all=1 without checking for a launched campaign", async () => {
    render(await brandPage({ all: "1" }));
    expect(screen.getByText("SunPeak: 1 photos")).toBeInTheDocument();
    expect(reads.hasLaunchedCampaign).not.toHaveBeenCalled();
  });

  it("does not fetch another business's data when there is no business", async () => {
    reads.getPrimaryBusiness.mockResolvedValue(null);
    render(await brandPage());
    expect(screen.getByText("First setup: new business; choose language: true")).toBeInTheDocument();
    expect(reads.getBrandAssets).not.toHaveBeenCalled();
    expect(reads.getAdInstructions).not.toHaveBeenCalled();
    expect(reads.getMetaConnection).not.toHaveBeenCalled();
  });

  it("keeps the empty full page for a new business when all=1", async () => {
    reads.getPrimaryBusiness.mockResolvedValue(null);
    render(await brandPage({ all: "1" }));
    expect(screen.getByText("New business: 0 photos")).toBeInTheDocument();
    expect(reads.getBrandAssets).not.toHaveBeenCalled();
    expect(reads.hasLaunchedCampaign).not.toHaveBeenCalled();
  });

  it("retains the full-page fallback when the launch check fails", async () => {
    reads.hasLaunchedCampaign.mockRejectedValue(new Error("Campaigns could not be loaded."));
    render(await brandPage());
    expect(screen.getByText("SunPeak: 1 photos")).toBeInTheDocument();
  });

  it("still fails the full page if a required business read fails", async () => {
    reads.getAdInstructions.mockRejectedValue(new Error("Ad instructions could not be loaded."));
    await expect(brandPage()).rejects.toThrow("Ad instructions could not be loaded.");
  });

  it("propagates a language failure when the message card is visible", async () => {
    reads.requestWords.mockRejectedValue(new Error("Language unavailable."));
    await expect(brandPage()).rejects.toThrow("Language unavailable.");
    expect(console.error).toHaveBeenCalledWith("[brand.whatsappWords]", "Language unavailable.");
  });

  it("reports an unused language failure without blocking setup", async () => {
    reads.hasLaunchedCampaign.mockResolvedValue(false);
    reads.requestWords.mockRejectedValue(new Error("Language unavailable."));
    render(await brandPage());
    expect(screen.getByText("First setup: SunPeak; choose language: true")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("[brand.whatsappWords]", "Language unavailable.");
  });

  it("reports the type rather than the contents of a non-Error speculative failure", async () => {
    reads.hasLaunchedCampaign.mockResolvedValue(false);
    reads.requestWords.mockRejectedValue("private detail");
    render(await brandPage());
    expect(console.error).toHaveBeenCalledWith("[brand.whatsappWords]", "string");
  });

  it("does not show the message card or read WhatsApp status when Meta is not ready", async () => {
    reads.getMetaConnection.mockResolvedValue({ ...connection, ready: false });
    render(await brandPage());
    expect(screen.queryByText(/Message language:/)).not.toBeInTheDocument();
    expect(reads.readWhatsAppStatus).not.toHaveBeenCalled();
  });
});
