// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferenceSettings } from "@/components/preference-settings";
import { PrivacyRequests } from "@/components/privacy-requests";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const saved = { enabled: true, epoch: 2, notes: [
  { category: "language", value: "Usually Hinglish", version: 1, updated_at: "2026-09-30T00:00:00Z" },
] };

afterEach(() => vi.unstubAllGlobals());

describe("PreferenceSettings", () => {
  it("shows a paused note without using it, then allows forgetting it after resuming", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ ...saved, enabled: false, epoch: 3 });
      const body = JSON.parse(init.body as string);
      if (body.operation === "enable") return Response.json({ ...saved, epoch: 4 });
      if (body.operation === "forget") return Response.json({ enabled: true, epoch: 5, notes: [] });
      throw new Error("Unexpected operation");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PreferenceSettings businessId={businessId} />);
    expect(await screen.findByText("Usually Hinglish")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Use preferences" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Use preferences" }));
    expect(screen.getByRole("checkbox", { name: "Use preferences" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Forget Language" }));
    await waitFor(() => expect(screen.queryByText("Usually Hinglish")).not.toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toMatchObject({
      businessId, expectedEpoch: 4, operation: "forget", category: "language",
    });
  });

  it("does not claim an unsuccessful save", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method
      ? Response.json({ error: "Preferences changed. Reload before saving." }, { status: 409 })
      : Response.json(saved)));
    render(<PreferenceSettings businessId={businessId} />);
    await screen.findByText("Usually Hinglish");
    await user.type(screen.getByRole("textbox", { name: "Preference" }), "Usually conversational");
    await user.click(screen.getByRole("button", { name: "Remember preference" }));
    expect(await screen.findByText(/Preferences changed\. Reload before saving/)).toBeInTheDocument();
    expect(screen.queryByText("Preference saved.")).not.toBeInTheDocument();
  });

  it("edits an existing note and clears all saved content", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json(saved);
      const body = JSON.parse(init.body as string);
      if (body.operation === "save") return Response.json({ enabled: true, epoch: 3, notes: [
        { ...saved.notes[0], value: body.value, version: 2 },
      ] });
      if (body.operation === "clear") return Response.json({ enabled: true, epoch: 4, notes: [] });
      throw new Error("Unexpected operation");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PreferenceSettings businessId={businessId} />);
    await screen.findByText("Usually Hinglish");
    await user.click(screen.getByRole("button", { name: "Edit Language" }));
    const value = screen.getByRole("textbox", { name: "Preference" });
    expect(value).toHaveValue("Usually Hinglish");
    await user.clear(value);
    await user.type(value, "Usually English");
    await user.click(screen.getByRole("button", { name: "Remember preference" }));
    expect(await screen.findByText("Usually English")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toMatchObject({
      expectedEpoch: 2, operation: "save", category: "language", value: "Usually English",
    });
    await user.click(screen.getByRole("button", { name: "Forget all preferences" }));
    await waitFor(() => expect(screen.queryByText("Usually English")).not.toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ expectedEpoch: 3, operation: "clear" });
    vi.restoreAllMocks();
  });
});

describe("PrivacyRequests", () => {
  it("confirms a saved export request and shows its current status", async () => {
    const request = { id: "22222222-2222-4222-8222-222222222222", kind: "export", status: "received", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/operator")
      ? Response.json({ error: "Forbidden" }, { status: 403 }) : init?.method
        ? Response.json({ request }, { status: 201 }) : Response.json({ requests: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PrivacyRequests />);
    await screen.findByText("No requests yet.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Request export" }));
    expect(await screen.findByText(/Export request received/)).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.queryByText("Operator request queue")).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ kind: "export" });
  });

  it("does not claim a failed deletion request was submitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/operator")
      ? Response.json({ error: "Forbidden" }, { status: 403 }) : init?.method
        ? Response.json({ error: "Could not submit your request." }, { status: 503 }) : Response.json({ requests: [] })));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PrivacyRequests />);
    await screen.findByText("No requests yet.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Request deletion" }));
    expect(await screen.findByText("Could not submit your request.")).toBeInTheDocument();
    expect(screen.queryByText(/Deletion request received/)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("shows an authorized operator queue and updates a matching request status", async () => {
    const request = { id: "22222222-2222-4222-8222-222222222222", owner_id: "11111111-1111-4111-8111-111111111111",
      kind: "export", status: "received", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z" };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/operator")
      ? init?.method === "PATCH" ? Response.json({ request: { ...request, status: "in_review" } })
        : Response.json({ requests: [request] }) : Response.json({ requests: [request] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PrivacyRequests />);
    expect(await screen.findByText("Operator request queue")).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: /Update export request/ }), "in_review");
    expect((await screen.findAllByText("In review")).length).toBeGreaterThan(0);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toMatchObject({
      id: request.id, expectedStatus: "received", status: "in_review",
    });
  });
});