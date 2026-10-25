// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedPageStep } from "@/components/managed-page-step";

// #523: the customer's Page step for 2-Tier onboarding (#526 mounts it).
const attemptId = "11111111-1111-4111-8111-111111111111";
let pages: { id: string; name: string }[];
let linked: { pageId: string; state: string } | null;
const calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  pages = [{ id: "111", name: "Solaride Mohali" }];
  linked = null;
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: input, method, body });
    if (input.startsWith("/api/meta/managed/page") && method === "GET") return Response.json({ ok: true, data: { pages, createUrl: "https://www.facebook.com/pages/create/", linked } });
    if (input === "/api/meta/managed/page" && method === "POST") { linked = { pageId: body.pageId, state: "page_linked" }; return Response.json({ ok: true, data: { ok: true, state: "page_linked", pageId: body.pageId } }); }
    if (input === `/api/meta/connections/attempts/${attemptId}`) return Response.json({ ok: true, data: { revision: 4 } });
    if (input === `/api/meta/connections/attempts/${attemptId}/retry`) { pages = [{ id: "333", name: "New Page" }]; return Response.json({ ok: true, data: { revision: 5 } }); }
    throw new Error(`unexpected ${method} ${input}`);
  }));
});

describe("<ManagedPageStep> (#523)", () => {
  it("links a Page the owner administers with one tap", async () => {
    const onLinked = vi.fn();
    render(<ManagedPageStep attemptId={attemptId} onLinked={onLinked} />);
    const use = await screen.findByRole("button", { name: "Use Solaride Mohali" });
    expect(use.className).toMatch(/\bh-11\b|min-h-11/);
    fireEvent.click(use);
    expect(await screen.findByText(/Solaride Mohali is linked/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ attemptId, pageId: "111" });
    expect(onLinked).toHaveBeenCalledWith("111");
  });

  it("without a Page: opens Meta's Page creator, then Check again finds the new Page", async () => {
    pages = [];
    render(<ManagedPageStep attemptId={attemptId} />);
    const create = await screen.findByRole("link", { name: /Create a Page on Facebook/ });
    expect(create).toHaveAttribute("href", "https://www.facebook.com/pages/create/");
    expect(create).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("button", { name: "Use New Page" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/retry"))?.body).toEqual({ revision: 4 });
  });

  it("shows an already-linked Page instead of the choices", async () => {
    linked = { pageId: "111", state: "child_created" };
    render(<ManagedPageStep attemptId={attemptId} />);
    expect(await screen.findByText(/Solaride Mohali is linked/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Use / })).toBeNull());
  });
});
