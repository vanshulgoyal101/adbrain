// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerBalance } from "@/components/customer-balance";
import { PreferenceSettings } from "@/components/preference-settings";
import { PrivacyRequests } from "@/components/privacy-requests";

const businessId = "11111111-1111-4111-8111-111111111111";
const balance = {
  businessId, capturedPaise: 1_000_000, refundedPaise: 0, serviceAllocationPaise: 200_000, advertisingAllocationPaise: 800_000,
  mediaCostPaise: 0, taxCostPaise: 0, reservedPaise: 0, remainingPaise: 800_000, held: false, reason: null, reservations: [],
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("Settings panels with server-loaded data (#238)", () => {
  it("render at once and make no mount request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<>
      <CustomerBalance businessId={businessId} initialBalance={balance as never} />
      <PreferenceSettings businessId={businessId} initialState={{ enabled: true, epoch: 3, notes: [] }} />
      <PrivacyRequests initialRequests={[{ id: "r1", kind: "export", status: "received", created_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-23T10:00:00Z" }]} initialOperatorAvailable />
    </>);
    expect(screen.getByText("Available for a new reservation")).toBeInTheDocument();
    expect(screen.queryByText("Checking allowance")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading requests")).not.toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still load on the client when the server read was unavailable", async () => {
    const fetchMock = vi.fn(async () => Response.json({}, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<>
      <CustomerBalance businessId={businessId} initialBalance={null} />
      <PreferenceSettings businessId={businessId} initialState={null} />
      <PrivacyRequests initialRequests={null} />
    </>);
    await vi.waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]).sort()).toEqual([
      "/api/payments/customer-balance", "/api/preferences", "/api/privacy-requests", "/api/privacy-requests/operator",
    ]));
  });
});
