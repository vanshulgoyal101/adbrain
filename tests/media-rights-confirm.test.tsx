// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaRightsConfirm } from "@/components/media-rights-confirm";
import { MEDIA_PEOPLE_TEXT, MEDIA_RIGHTS_TEXT } from "@/lib/media/consent";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("<MediaRightsConfirm> (#784)", () => {
  it("saves the tick with no upload, then refreshes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<MediaRightsConfirm businessId="b1" vertical="solar energy" />);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(MEDIA_RIGHTS_TEXT));
    fireEvent.click(confirm);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/media/consent", expect.objectContaining({ body: JSON.stringify({ businessId: "b1", rights: true, people: false }) }));
  });

  it("also needs the people tick for a clinic and shows a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Tick to confirm." }) }));
    render(<MediaRightsConfirm businessId="b1" vertical="dental clinic" />);
    fireEvent.click(screen.getByLabelText(MEDIA_RIGHTS_TEXT));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(MEDIA_PEOPLE_TEXT));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tick to confirm.");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
