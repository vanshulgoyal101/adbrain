// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import hi from "../messages/hi.json";
import { MetaConnectionPanel } from "@/components/meta-connection";
import { PreferenceSettings } from "@/components/preference-settings";
import { PrivacyRequests } from "@/components/privacy-requests";
import { WhatsAppStatusPanel } from "@/components/whatsapp-status";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const words = { locale: "hi" as const, messages: hi.settings };
const state = { enabled: true, epoch: 1, notes: [{ category: "tone" as const, value: "दोस्ताना", updated_at: "2026-10-01T10:00:00Z", version: 1 }] };

afterEach(cleanup);

describe("Settings in Hindi (#1438)", () => {
  it("shows the preferences panel in Hindi", () => {
    render(<PreferenceSettings businessId="b1" initialState={state} words={words} />);
    expect(screen.getByRole("heading", { name: "विज्ञापन की पसंद" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "पसंद याद रखें" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "लहजा बदलें" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "विज्ञापनों में क्या न हो" })).toBeTruthy();
  });

  it("shows privacy requests and their status in Hindi", () => {
    render(<PrivacyRequests words={words} initialRequests={[{ id: "r1", kind: "export", status: "in_review", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z" }]} />);
    expect(screen.getByRole("heading", { name: "प्राइवेसी और डेटा अनुरोध" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "डिलीट का अनुरोध करें" })).toBeTruthy();
    expect(screen.getByText("देखा जा रहा है")).toBeTruthy();
  });

  it("keeps WhatsApp and Facebook in Latin script in the linking guide", () => {
    render(<WhatsAppStatusPanel businessId="b1" initialStatus={{ state: "not_linked" }} words={words} />);
    expect(screen.getByRole("heading", { name: "WhatsApp चैट विज्ञापन" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(hi.settings.whatsappStatus.notLinked);
    expect(screen.getByText(/^अपने Facebook Page पर:/)).toBeTruthy();
  });

  it("shows the Meta connection panel in Hindi", () => {
    const connection = { source: "oauth" as const, pending: false, ready: false, adAccountId: null, pageId: null, tokenExpiresAt: null, expired: true, scopes: [] };
    render(<MetaConnectionPanel businessId="b1" connection={connection} oauthConfigured locale="hi" />);
    expect(screen.getByRole("heading", { name: "Meta कनेक्शन" })).toBeTruthy();
    expect(screen.getByText(hi.settings.meta.expired)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Facebook फिर से जोड़ें" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Facebook हटाएँ" })).toBeTruthy();
  });
});
