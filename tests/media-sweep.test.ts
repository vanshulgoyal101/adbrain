import { describe, expect, it } from "vitest";
import { sweepMedia } from "@/lib/media/sweep";
import { fakeSupabase } from "./helpers/media-fake";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-04T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const bytes = new Uint8Array([1]);

function row(id: string, extra: Record<string, unknown>) {
  return { id, business_id: BUSINESS, kind: "image", path: `${BUSINESS}/${id}.jpg`, status: "pending", deleted_at: null, created_at: ago(1), ...extra };
}

describe("sweepMedia (#2644)", () => {
  it("retires pending rows older than a day with their object, and leaves fresh and ready ones", async () => {
    const db = fakeSupabase();
    db.tables.media_assets.push(row("old", { created_at: ago(25) }), row("fresh", {}), row("done", { status: "ready", created_at: ago(30) }));
    for (const path of [`${BUSINESS}/old.jpg`, `${BUSINESS}/fresh.jpg`, `${BUSINESS}/done.jpg`]) { db.objects.set(path, bytes); db.objectTimes.set(path, ago(1)); }
    const result = await sweepMedia(db.client, NOW);
    expect(result).toMatchObject({ stalePending: 1, failed: 0 });
    expect(db.objects.has(`${BUSINESS}/old.jpg`)).toBe(false);
    expect(db.tables.media_assets.find((item) => item.id === "old")?.deleted_at).toBe(NOW.toISOString());
    expect(db.tables.media_assets.filter((item) => !item.deleted_at).map((item) => item.id).sort()).toEqual(["done", "fresh"]);
  });

  it("removes the object a late token stored at a recently retired pending row's path", async () => {
    const db = fakeSupabase();
    db.tables.media_assets.push(row("retired", { deleted_at: ago(5) }), row("ancient", { deleted_at: ago(24 * 10) }));
    db.objects.set(`${BUSINESS}/retired.jpg`, bytes);
    db.objects.set(`${BUSINESS}/ancient.jpg`, bytes);
    db.objectTimes.set(`${BUSINESS}/retired.jpg`, ago(1));
    db.objectTimes.set(`${BUSINESS}/ancient.jpg`, ago(1));
    const result = await sweepMedia(db.client, NOW);
    expect(result.retiredObjects).toBe(1);
    expect(db.removed).toContain(`${BUSINESS}/retired.jpg`);
    expect(db.removed).not.toContain(`${BUSINESS}/ancient.jpg`);
  });

  it("removes only unreferenced objects older than 3 h and keeps every live row's object", async () => {
    const db = fakeSupabase();
    db.tables.media_assets.push(
      row("ready", { status: "ready", created_at: ago(50), path: `${BUSINESS}/final.jpg` }),
      row("failed", { status: "delete_failed", created_at: ago(50), path: `${BUSINESS}/stuck.jpg` }),
      row("gone", { status: "ready", created_at: ago(50), path: `${BUSINESS}/gone.jpg`, deleted_at: ago(40) }),
    );
    const stored: [string, number][] = [["final.jpg", 50], ["stuck.jpg", 50], ["stray.jpg", 5], ["young.jpg", 1], ["gone.jpg", 40]];
    for (const [name, age] of stored) { db.objects.set(`${BUSINESS}/${name}`, bytes); db.objectTimes.set(`${BUSINESS}/${name}`, ago(age)); }
    const result = await sweepMedia(db.client, NOW);
    expect(result.orphans).toBe(2);
    expect([...db.objects.keys()].sort()).toEqual([`${BUSINESS}/final.jpg`, `${BUSINESS}/stuck.jpg`, `${BUSINESS}/young.jpg`]);
  });

  it("never reads another business's rows to decide a folder's orphans", async () => {
    const db = fakeSupabase();
    const other = "33333333-3333-4333-8333-333333333333";
    db.tables.media_assets.push({ ...row("theirs", { status: "ready", path: `${other}/a.jpg` }), business_id: other });
    db.objects.set(`${other}/a.jpg`, bytes); db.objectTimes.set(`${other}/a.jpg`, ago(9));
    db.objects.set(`${BUSINESS}/a.jpg`, bytes); db.objectTimes.set(`${BUSINESS}/a.jpg`, ago(9));
    await sweepMedia(db.client, NOW);
    expect([...db.objects.keys()]).toEqual([`${other}/a.jpg`]);
  });
});
