// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadEmailSetting } from "@/components/lead-email-setting";

const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("enquiry email setting", () => {
  it("loads the saved choice and saves a change", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ enabled: true, available: true }));
    render(<LeadEmailSetting businessId={businessId} />);
    const box = await screen.findByRole("checkbox", { name: "Email me about new enquiries" });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();
    expect(screen.queryByText(/not switched on yet/)).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(Response.json({ enabled: false, available: true }));
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ businessId, enabled: false });
  });

  it("says when alerts are not switched on yet", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ enabled: true, available: false }));
    render(<LeadEmailSetting businessId={businessId} />);
    expect(await screen.findByText(/not switched on yet/)).toBeInTheDocument();
  });

  it("keeps the box disabled and shows the error when the setting cannot be loaded or saved", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not load the email setting." }, { status: 503 }));
    render(<LeadEmailSetting businessId={businessId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the email setting.");
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("shows an error and keeps the old value when a save fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ enabled: true, available: true }));
    render(<LeadEmailSetting businessId={businessId} />);
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not load the email setting." }, { status: 503 }));
    fireEvent.click(box);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(box).toBeChecked();
  });
});
