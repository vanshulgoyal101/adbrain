import { describe, expect, it } from "vitest";
import throttleTape from "./fixtures/meta/throttle.json";
import revokedToken from "./fixtures/meta/token-revoked.json";
import { businessId, checkpointRace, db, deadBusiness, replay, repeatedCursor, run, seedRepeatedCursorRun } from "./lead-sync-cron-harness";

describe("core: scheduled lead sync failure contract (#2503)", () => {
  it("reports imports committed before losing a later checkpoint race", async () => {
    db.checkpointError = checkpointRace;
    db.checkpointErrorVersion = 3;
    replay();
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true, imported: 1, businesses: [{ businessId, imported: 1, skipped: "Another run is syncing." }],
    });
    expect(db.leads.size).toBe(1);
  });

  it.each([
    { stage: "start", code: "40001", message: "Meta binding changed" },
    { stage: "checkpoint", code: "40001", message: "Meta binding changed" },
    { stage: "checkpoint", code: "40001", message: "Sync binding changed; start a fresh sync" },
    { stage: "checkpoint", code: "40001", message: "could not serialize access due to concurrent update" },
    { stage: "checkpoint", code: "23505", message: "Sync progress changed; reload and resume" },
    { stage: "start", code: "40001", message: "Sync progress changed; reload and resume" },
    { stage: "checkpoint", code: "08006", message: "connection failed" },
    { stage: "start", code: "42501", message: "Business unavailable" },
    { stage: "checkpoint", code: "P0002", message: "Sync unavailable" },
  ])("fails on $stage database error $code: $message", async ({ stage, code, message }) => {
    const error = { code, message, details: null, hint: null };
    if (stage === "start") db.startError = error;
    else db.checkpointError = error;
    const sent = replay();
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, imported: 0, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].skipped).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(message);
    expect(db.leads.size).toBe(0);
    if (stage === "start") expect(sent).toEqual([]);
  });

  it("fails closed when a 40001 checkpoint error has no message", async () => {
    db.checkpointError = { code: "40001", details: null, hint: null };
    replay();
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].skipped).toBeUndefined();
  });

  it("does not hide a Meta read failure behind a simultaneous checkpoint race", async () => {
    db.checkpointError = checkpointRace;
    replay(() => true);
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].skipped).toBeUndefined();
  });

  it("does not hide a revoked token behind a simultaneous checkpoint race", async () => {
    db.connections = [{ business_id: deadBusiness }];
    db.checkpointError = checkpointRace;
    replay();
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.reauth).toHaveLength(1);
    expect(result.body.businesses).toEqual([]);
  });

  it("does not hide a concurrent repeated-cursor failure behind a checkpoint race", async () => {
    seedRepeatedCursorRun();
    db.checkpointError = checkpointRace;
    replay(undefined, repeatedCursor);
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].skipped).toBeUndefined();
  });

  it("preserves the documented throttle-only skip", async () => {
    replay(() => true, undefined, [], { status: 400, body: throttleTape.error17 });
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body.businesses[0]).toMatchObject({ businessId, throttled: { scope: "account" } });
    expect(result.body.businesses[0].error).toBeUndefined();
  });

  it("does not let a Meta throttle hide a database failure", async () => {
    db.checkpointError = { code: "08006", message: "connection failed", details: null, hint: null };
    replay(() => true, undefined, [], { status: 400, body: throttleTape.error17 });
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].throttled).toBeUndefined();
  });

  it("does not let one throttled form hide another form's provider failure", async () => {
    replay(
      path => path.startsWith("2531491190682703/leads") || path.startsWith("1667547894289050/leads"),
      undefined, [],
      path => path.startsWith("2531491190682703/leads")
        ? { status: 400, body: throttleTape.error17 }
        : { status: 503, body: { error: { message: "Service unavailable", code: 2 } } },
    );
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].throttled).toBeUndefined();
  });

  it("does not let one throttled form hide another form's recorded token refusal", async () => {
    replay(
      path => path.startsWith("2531491190682703/leads") || path.startsWith("1667547894289050/leads"),
      undefined, [],
      path => path.startsWith("2531491190682703/leads")
        ? { status: 400, body: throttleTape.error17 }
        : revokedToken,
    );
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, businesses: [], reauth: [expect.any(Object)] });
  });

  it("does not let a throttle hide a repeated cursor detected after a successful Meta response", async () => {
    seedRepeatedCursorRun();
    replay(path => path.startsWith("2531491190682703/leads"), repeatedCursor, [], { status: 400, body: throttleTape.error17 });
    const result = await run();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, businesses: [{ businessId, error: expect.any(String) }] });
    expect(result.body.businesses[0].throttled).toBeUndefined();
  });

});
