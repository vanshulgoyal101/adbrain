import { describe, expect, it } from "vitest";
import { adminPages, linkManagedPage, META_PAGE_CREATE_URL, type ManagedAccountStore } from "@/lib/meta/managed-page";

// #523 (2-Tier): the customer's own Page becomes the child business's shared page and the ad
// account's end_advertiser. Meta requires the customer to be an admin of it (error 1690138).
const snapshot = {
  kind: "asset_snapshot",
  pages: [
    { id: "111", name: "Solaride Mohali", tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MANAGE", "MESSAGING", "MODERATE"] },
    { id: "222", name: "Friend's shop", tasks: ["ADVERTISE", "ANALYZE"] },
    { id: "333", name: "No tasks" },
  ],
};

function memory(row?: Record<string, unknown>) {
  const events: Record<string, unknown>[] = [];
  let current = row ? { ...row } : null;
  const store: ManagedAccountStore = {
    get: async () => current as never,
    insert: async (values) => { current = { child_business_id: null, ...values }; },
    update: async (values) => { current = { ...current!, ...values }; },
    event: async (event) => { events.push(event); },
  };
  return { store, events, row: () => current };
}

describe("managed Page (#523)", () => {
  it("offers only Pages the customer administers, and Meta's Page creator otherwise", () => {
    expect(adminPages(snapshot)).toEqual([{ id: "111", name: "Solaride Mohali" }]);
    expect(adminPages(null)).toEqual([]);
    expect(adminPages({ pages: [{ id: "x1", name: "Bad id", tasks: ["MANAGE"] }] })).toEqual([]);
    expect(META_PAGE_CREATE_URL).toBe("https://www.facebook.com/pages/create/");
  });

  it("links an admin Page: the row reaches page_linked and the step is logged", async () => {
    const db = memory();
    expect(await linkManagedPage(db.store, { businessId: "b1", pageId: "111", snapshot, requestId: "r1" })).toEqual({ ok: true, state: "page_linked", pageId: "111" });
    expect(db.row()).toMatchObject({ business_id: "b1", page_id: "111", state: "page_linked" });
    expect(db.events).toEqual([{ business_id: "b1", step: "page", outcome: "succeeded", meta_object_id: "111", request_id: "r1" }]);
  });

  it("refuses a Page the customer doesn't administer", async () => {
    const db = memory();
    expect(await linkManagedPage(db.store, { businessId: "b1", pageId: "222", snapshot })).toEqual({ ok: false, code: "PAGE_NOT_ADMIN" });
    expect(db.row()).toBeNull();
    expect(db.events).toEqual([]);
  });

  it("lets the owner pick another Page until the child business exists, then keeps it", async () => {
    const before = memory({ business_id: "b1", state: "page_linked", page_id: "999", child_business_id: null });
    expect(await linkManagedPage(before.store, { businessId: "b1", pageId: "111", snapshot })).toMatchObject({ ok: true, state: "page_linked" });
    expect(before.row()).toMatchObject({ page_id: "111" });

    const after = memory({ business_id: "b1", state: "child_created", page_id: "999", child_business_id: "555" });
    expect(await linkManagedPage(after.store, { businessId: "b1", pageId: "111", snapshot })).toEqual({ ok: false, code: "PAGE_LOCKED" });
    expect(after.row()).toMatchObject({ page_id: "999", state: "child_created" });

    const same = memory({ business_id: "b1", state: "ready", page_id: "111", child_business_id: "555" });
    expect(await linkManagedPage(same.store, { businessId: "b1", pageId: "111", snapshot })).toEqual({ ok: true, state: "ready", pageId: "111" });
    expect(same.events).toEqual([]);
  });
});
