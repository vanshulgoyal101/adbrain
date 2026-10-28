// @vitest-environment jsdom
// #1438: Settings saves the owner's app language in a cookie that Home reads.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
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
});
