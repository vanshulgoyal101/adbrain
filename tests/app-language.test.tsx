// @vitest-environment jsdom
// #1438: Settings saves the owner's app language in a cookie that Home reads.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn(), get: () => undefined, getAll: () => [] }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
// The action's logging writes through Supabase in CI; this test is about the cookie only.
vi.mock("@/lib/observability/logger", () => ({ observeAction: (_name: string, handler: () => Promise<unknown>) => handler() }));
const action = vi.hoisted(() => ({ setAppLanguage: vi.fn<(value: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true })) }));

describe("setAppLanguage", () => {
  beforeEach(() => jar.set.mockReset());

  it("keeps the choice for a year on this browser", async () => {
    const { setAppLanguage } = await vi.importActual<typeof import("@/app/(app)/settings/language-actions")>("@/app/(app)/settings/language-actions");
    await expect(setAppLanguage("hi")).resolves.toEqual({ ok: true });
    expect(jar.set).toHaveBeenCalledWith("adbrain_lang", "hi", expect.objectContaining({ path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax", httpOnly: true }));
  });

  it("an unknown language saves English", async () => {
    const { setAppLanguage } = await vi.importActual<typeof import("@/app/(app)/settings/language-actions")>("@/app/(app)/settings/language-actions");
    await setAppLanguage("fr");
    expect(jar.set).toHaveBeenCalledWith("adbrain_lang", "en", expect.anything());
  });
});

describe("AppLanguage", () => {
  it("shows both languages and saves the one tapped", async () => {
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { AppLanguage } = await import("@/components/app-language");
    render(<AppLanguage initial="en" labels={{ language: "App language", hint: "Home shows in Hindi now.", saveFailed: "Couldn't save." }} />);
    expect(screen.getByRole("heading", { name: "App language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    await waitFor(() => expect(action.setAppLanguage).toHaveBeenCalledWith("hi"));
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so and goes back when saving fails", async () => {
    action.setAppLanguage.mockResolvedValueOnce({ ok: false });
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { AppLanguage } = await import("@/components/app-language");
    render(<AppLanguage initial="en" labels={{ language: "App language", hint: "", saveFailed: "Couldn't save." }} />);
    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save.");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  });

  // #1503: Hindi labels are marked as Hindi, so screen readers pronounce them and the type system gives them taller lines.
  it("marks its labels with the language they're written in", async () => {
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { AppLanguage } = await import("@/components/app-language");
    const { unmount } = render(<AppLanguage initial="hi" labels={{ language: "ऐप की भाषा", hint: "", saveFailed: "सेव नहीं हुआ।" }} />);
    expect(screen.getByRole("heading", { name: "ऐप की भाषा" }).closest("section")).toHaveAttribute("lang", "hi");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    unmount();
    render(<AppLanguage initial="en" labels={{ language: "App language", hint: "", saveFailed: "Couldn't save." }} />);
    expect(screen.getByRole("heading", { name: "App language" }).closest("section")).not.toHaveAttribute("lang");
  });
});

// #1641 (CPO #1621): WS1 step 1 offers the language until one is chosen; English by default, never from the browser.
describe("AppLanguage, compact (step 1)", () => {
  it("labelled in both scripts, nothing pre-picked; one tap saves it and the row goes away", async () => {
    action.setAppLanguage.mockClear();
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { CompactAppLanguage } = await import("@/components/app-language");
    render(<CompactAppLanguage />);
    const group = screen.getByRole("group", { name: "Language / भाषा" });
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("lang", "hi");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(action.setAppLanguage).toHaveBeenCalledWith("en"));
    await waitFor(() => expect(group).not.toBeInTheDocument());
  });

  it("after हिंदी, a one-line note says only Home is in Hindi so far", async () => {
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { CompactAppLanguage } = await import("@/components/app-language");
    render(<CompactAppLanguage />);
    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    await waitFor(() => expect(action.setAppLanguage).toHaveBeenCalledWith("hi"));
    expect(await screen.findByText("अभी सिर्फ़ होम हिंदी में है; बाकी स्क्रीन एक-एक करके जुड़ेंगी।")).toHaveAttribute("lang", "hi");
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
  });

  it("a failed save keeps the choice on screen and says so", async () => {
    action.setAppLanguage.mockResolvedValueOnce({ ok: false });
    vi.doMock("@/app/(app)/settings/language-actions", () => action);
    const { CompactAppLanguage } = await import("@/components/app-language");
    render(<CompactAppLanguage />);
    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Try again. / सेव नहीं हुआ। फिर से चुनें।");
    expect(screen.getByRole("button", { name: "हिंदी" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("localeChosen (#1641)", () => {
  it("is false until the language cookie is set, then true", async () => {
    const { localeChosen } = await import("@/i18n/request-locale");
    const get = vi.spyOn(jar, "get");
    get.mockReturnValueOnce(undefined);
    await expect(localeChosen()).resolves.toBe(false);
    get.mockReturnValueOnce({ name: "adbrain_lang", value: "en" } as never);
    await expect(localeChosen()).resolves.toBe(true);
  });
});
