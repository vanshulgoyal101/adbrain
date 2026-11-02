import { beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as { name: string; outcome: string; attributes: Record<string, unknown> }[]);
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: (event: (typeof events)[number]) => events.push(event) }));

import { CreativeSaveError, saveCreative } from "@/lib/creative/save";

type Reply = { data: unknown; error: { code: string; message: string } | null };

/** A creatives table whose inserts answer from `replies` in turn; `landed` ids are rows the database kept. */
function table(replies: Reply[], { landOnFailure = false } = {}) {
  const inserts: { id: string }[] = [];
  const landed = new Set<string>();
  const client = {
    from: () => ({
      insert: (row: { id: string }) => {
        inserts.push(row);
        const reply = replies.shift() ?? { data: row, error: null };
        if (reply.error && landOnFailure) landed.add(row.id);
        return { select: () => ({ single: async () => reply }) };
      },
      select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: async () => ({ data: landed.has(id) ? { id } : null, error: null }) }) }),
    }),
  };
  return { client: client as never, inserts };
}

const row = { business_id: "business", brief: "Brief", variant_group: "group", status: "draft" as const, headline: "Offer" };

beforeEach(() => { events.length = 0; });

describe("saveCreative (#2494)", () => {
  it("saves a finished ad whose first insert failed in transit (Create run 41306939001 lost it)", async () => {
    const { client, inserts } = table([{ data: null, error: { code: "", message: "TypeError: fetch failed" } }]);
    const saved = await saveCreative(client, row);
    expect(inserts).toHaveLength(2);
    expect(inserts[1].id).toBe(inserts[0].id);
    expect(saved).toMatchObject({ id: inserts[0].id, headline: "Offer" });
    expect(events).toEqual([expect.objectContaining({ name: "creative.save", outcome: "failed", attributes: expect.objectContaining({ errorCode: "UNKNOWN", attempt: 1 }) })]);
  });

  it("reads back an insert that landed but lost its reply instead of saving the ad twice", async () => {
    const { client, inserts } = table([{ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }], { landOnFailure: true });
    const saved = await saveCreative(client, row);
    expect(inserts).toHaveLength(1);
    expect(saved).toEqual({ id: inserts[0].id });
  });

  it("does not retry an error that would fail the same way, and names its code", async () => {
    const { client, inserts } = table([{ data: null, error: { code: "22P05", message: "unsupported Unicode escape sequence" } }]);
    const failure = await saveCreative(client, row).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CreativeSaveError);
    expect(failure).toMatchObject({ code: "22P05" });
    expect(inserts).toHaveLength(1);
  });

  it("gives up after its retry with the last code", async () => {
    const down = { data: null, error: { code: "PGRST000", message: "down" } };
    const { client, inserts } = table([down, down]);
    await expect(saveCreative(client, row)).rejects.toMatchObject({ name: "CreativeSaveError", code: "PGRST000" });
    expect(inserts).toHaveLength(2);
    expect(events.map((event) => event.attributes.attempt)).toEqual([1, 2]);
  });
});
