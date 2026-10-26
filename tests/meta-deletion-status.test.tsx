// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #730: the status URL Meta gives the person shows their request's real status.
const rows = vi.hoisted(() => ({ value: [] as { status: string; created_at: string }[], error: null as unknown, code: "" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, code: string) => {
          rows.code = code;
          return { order: () => ({ limit: async () => ({ data: rows.value, error: rows.error }) }) };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const code = "0123456789abcdef";
async function page(query: string | undefined) {
  const { default: DataDeletionPage } = await import("@/app/data-deletion/page");
  render(await DataDeletionPage({ searchParams: Promise.resolve(query ? { code: query } : {}) }));
}

beforeEach(() => { rows.value = []; rows.error = null; rows.code = ""; });

describe("Meta deletion status (#730)", () => {
  it.each([
    [["received"], "Received"],
    [["received", "in_review"], "In review"],
    [["completed"], "Completed"],
    [["declined"], "Declined"],
  ])("%j reads %s", async (statuses, label) => {
    rows.value = statuses.map((status) => ({ status, created_at: "2026-10-26T09:00:00Z" }));
    await page(code);
    expect(rows.code).toBe(code);
    expect(screen.getByRole("status")).toHaveTextContent(`Status: ${label}`);
  });

  it("says so honestly when the code isn't found, and never looks up a malformed code", async () => {
    await page(code);
    expect(screen.getByRole("status")).toHaveTextContent("We can't find a request with this code");
    rows.code = "";
    await page("not-a-code");
    expect(rows.code).toBe("");
  });

  it("the operator queue names the source and code of a Facebook request", async () => {
    const { privacyRequestSubject } = await import("@/lib/privacy-request-label");
    expect(privacyRequestSubject({ owner_id: null, source: "meta_callback", confirmation_code: code })).toBe(`Facebook request, no matching AdBrain owner (code ${code})`);
    expect(privacyRequestSubject({ owner_id: "owner-1", source: "meta_callback", confirmation_code: code })).toBe(`owner-1 · from Facebook (code ${code})`);
    expect(privacyRequestSubject({ owner_id: "owner-1", source: "owner", confirmation_code: null })).toBe("owner-1");
  });
});
