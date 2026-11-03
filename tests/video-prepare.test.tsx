// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoPrepare } from "@/components/video-prepare";

// #781: choosing an owner's file starts its send to Meta and shows where it is.
const words = { working: "Preparing", ready: "Ready", error: "Failed" };
const reply = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("VideoPrepare (#781)", () => {
  it("posts once per file to the business's own route and says when ready", async () => {
    const request = reply(200, { ok: true, status: "ready" });
    render(<VideoPrepare assetIds={["a", "a", "b"]} words={words} request={request} />);
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    expect((request as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]).sort()).toEqual(["/api/media/a/meta", "/api/media/b/meta"]);
  });
  it("says so when Meta or the server refuses", async () => {
    render(<VideoPrepare assetIds={["a"]} words={words} request={reply(409, { code: "META_NOT_CONNECTED" })} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
  });
  it("shows nothing with no files", () => {
    const { container } = render(<VideoPrepare assetIds={[]} words={words} request={reply(200, {})} />);
    expect(container.textContent).toBe("");
  });
});
