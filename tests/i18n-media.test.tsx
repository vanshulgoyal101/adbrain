// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import hi from "../messages/hi.json";
import { MediaLibrary } from "@/components/media-library";
import type { Codec } from "@/lib/media/client-upload";
import type { MediaView } from "@/lib/media/store";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const words = { locale: "hi" as const, messages: hi.media };
const shapes: Record<string, [number, number]> = { "tall.jpg": [1080, 1350], "wide.jpg": [1600, 900], "tiny.jpg": [400, 300] };
const codec: Codec = async (file) => {
  const [width, height] = shapes[file.name] ?? [1080, 1080];
  return { blob: new Blob([file.name], { type: "image/jpeg" }), width, height };
};
const photo: MediaView = { id: "m1", kind: "image", durationMs: null, name: "Kitchen", tags: [], width: 1080, height: 1080, bytes: 1, fit: { level: "feed", ratio: "1:1", message: "Square: fine for Feed." }, url: "https://example.com/m1.jpg", createdAt: "2026-10-29T10:00:00Z" };

afterEach(cleanup);

describe("Photos in Hindi (#778 walk 1)", () => {
  it("shows the library, its tabs and a photo's fit line in Hindi", () => {
    render(<MediaLibrary words={words} business={{ id: "b1", vertical: null }} media={[photo]} creatives={[]} brandAssets={[]} consented />);
    const tabs = screen.getByRole("tablist", { name: "दिखाएँ" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["सभी", "फ़ोटो", "AdBrain के बनाए"]);
    expect(screen.getByRole("button", { name: "फ़ोटो जोड़ें" })).toBeTruthy();
    expect(screen.getByText("चौकोर: Feed के लिए ठीक।")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kitchen के लिए और विकल्प" })).toBeTruthy();
    expect(screen.queryByText(/Square|Your photos|Add photos/)).toBeNull();
  });

  it("says the sheet, each pick's fit and the browser's own refusals in Hindi", async () => {
    render(<MediaLibrary words={words} business={{ id: "b1", vertical: null }} media={[]} creatives={[]} brandAssets={[]} consented startOpen
      deps={{ fetch: vi.fn(), uploadToSignedUrl: vi.fn() }} codec={codec} />);
    const sheet = screen.getByRole("dialog", { name: "फ़ोटो जोड़ें" });
    fireEvent.change(within(sheet).getByLabelText("फ़ोटो चुनें"), { target: { files: ["tall.jpg", "wide.jpg", "tiny.jpg"].map((name) => new File(["x"], name, { type: "image/jpeg" })).concat(new File(["x"], "a.gif", { type: "image/gif" })) } });
    await waitFor(() => expect(within(sheet).queryByText("जाँच हो रही है…")).toBeNull());
    const list = within(sheet).getByRole("list", { name: "आपकी चुनी फ़ोटो" });
    expect(within(list).getByText(hi.media.fit.ok)).toBeTruthy();
    expect(within(list).getByText("चौड़ी (16:9): Feed में दिखेगी; Stories और Reels के लिए लंबी फ़ोटो चाहिए।")).toBeTruthy();
    expect(within(list).getByText("बहुत छोटी (300 px चौड़ी)। असली फ़ोटो लगाइए, स्क्रीनशॉट या WhatsApp वाली कॉपी नहीं।")).toBeTruthy();
    expect(within(list).getByText(hi.media.upload.format)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "2 फ़ोटो जोड़ें" })).toBeTruthy();
  });
});
