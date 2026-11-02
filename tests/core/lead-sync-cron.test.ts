import { beforeEach, describe, expect, it, vi } from "vitest";
import revokedToken from "./fixtures/meta/token-revoked.json";
import { businessId, CLOUD_ACCEPTED, db, deadBusiness, replay, run, testLead } from "./lead-sync-cron-harness";

describe("core: scheduled lead sync against recorded Graph pages (#165)", () => {
  it("rejects calls without the scheduler secret before reading anything", async () => {
    const sent = replay();
    expect((await run(null)).status).toBe(401);
    expect((await run("Bearer wrong-secret")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    vi.resetModules();
    expect((await run()).status).toBe(404);
    expect(sent).toEqual([]);
    expect(db.leads.size).toBe(0);
  });

  it("imports the recorded test lead exactly once, and a second run imports nothing new", async () => {
    const sent = replay();
    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true, imported: 1,
      businesses: [{ businessId, imported: 1, failedForms: 0, sync: { state: "complete", hasMore: false } }],
    });
    expect([...db.leads.values()]).toEqual([expect.objectContaining({
      business_id: businessId, meta_lead_id: testLead, form_id: "1732372914636573",
      full_name: "<test lead: dummy data for full_name>", created_time: "2026-10-22T05:39:35+0000",
      // #680: Meta answers a test lead without campaign_id (recorded); it stays unlinked.
      meta_campaign_id: null,
    })]);
    expect(sent.filter(path => path.includes("/leads?")).every(path => path.includes("campaign_id"))).toBe(true);
    expect(sent.filter(path => path.includes("/leads?"))).toHaveLength(5);

    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, imported: 0, businesses: [{ businessId, imported: 0 }] });
    expect(db.leads.size).toBe(1);
  });

  it("scopes every checkpoint and imported row to the authorized business and Meta binding", async () => {
    replay();
    expect((await run()).status).toBe(200);
    expect(db.scopes.filter(scope => scope.name === "lead_sync_start")).toHaveLength(1);
    expect(db.scopes.filter(scope => scope.name === "lead_sync_checkpoint").length).toBeGreaterThan(0);
    expect(db.scopes).toEqual(db.scopes.map(scope => expect.objectContaining({
      businessId, ownerId: "owner-1", generation: 1, adAccountId: "act_9000000000000001", pageId: "900000000000002",
      rowBusinessIds: scope.rowBusinessIds.map(() => businessId),
    })));
    expect(db.leads.get(`${businessId}:${testLead}`)).toMatchObject({ business_id: businessId });
  });

  it("#680: passes an ad lead's Meta campaign id to the checkpoint, and drops a malformed one", async () => {
    for (const [campaignId, expected] of [["120253707024160526", "120253707024160526"], ["act_1; drop", null]] as const) {
      db.runs.clear();
      db.leads.clear();
      replay(undefined, (path, body) => {
        if (!path.startsWith("1732372914636573/leads")) return body;
        const page = body as { data: Record<string, unknown>[] };
        return { ...page, data: page.data.map(lead => ({ ...lead, campaign_id: campaignId })) };
      });
      expect((await run()).status).toBe(200);
      expect([...db.leads.values()]).toEqual([expect.objectContaining({ meta_lead_id: testLead, meta_campaign_id: expected })]);
      vi.restoreAllMocks();
    }
  });

  it("#758: one owner's dead token is listed by opaque key; the healthy business still imports and the run stays green", async () => {
    const { createHash } = await import("node:crypto");
    db.connections = [{ business_id: deadBusiness }, { business_id: businessId }];
    replay();
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, imported: 1, businesses: [{ businessId, imported: 1 }] });
    expect(result.body.reauth).toEqual([{ key: createHash("sha256").update(deadBusiness).digest("hex").slice(0, 12), since: expect.any(String), activeCampaigns: expect.any(Number) }]);
    expect(JSON.stringify(result.body.reauth)).not.toContain(deadBusiness);
  });

  it("counts saved imports before a later recorded token refusal", async () => {
    replay(path => path.startsWith("1206878731403456/leads"), undefined, [], revokedToken);
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, imported: 1, businesses: [], reauth: [expect.any(Object)] });
    expect(db.leads.size).toBe(1);
  });

  it("fails red with saved progress when Meta cannot be read, never a silent empty import", async () => {
    replay(path => path.startsWith("1732372914636573/leads"));
    const failed = await run();
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      ok: false, imported: 0,
      businesses: [{ businessId, imported: 0, failedForms: 1, sync: { state: "partial", hasMore: true }, error: expect.stringContaining("Could not read all Meta enquiries") }],
    });

    replay();
    const retried = await run();
    expect(retried.body).toMatchObject({ ok: true, imported: 1 });
    expect(db.leads.size).toBe(1);
  });

  it("#2503: two overlapping runs both return 200; the one that lost the checkpoint is skipped and the lead lands once", async () => {
    replay();
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    let starts = 0;
    db.startBarrier = async () => {
      if (++starts === 2) release();
      await bothStarted;
    };
    const outcomes = await Promise.all([run(), run()]);
    expect(outcomes.map(({ status }) => status)).toEqual([200, 200]);
    expect(outcomes.map(({ body }) => body.imported).sort()).toEqual([0, 1]);
    const businesses = outcomes.map(({ body }) => body.businesses[0]);
    expect(businesses.filter((business) => business.skipped === "Another run is syncing.")).toHaveLength(1);
    expect(businesses.every((business) => !business.error)).toBe(true);
    expect(db.leads.size).toBe(1);
    expect(db.leads.get(`${businessId}:${testLead}`)).toMatchObject({ business_id: businessId, meta_lead_id: testLead });
  });

  describe("#701 v1: the owner's WhatsApp lead alert after the import", () => {
    beforeEach(() => {
      // The recorded test lead arrived at 05:39:35Z; the run is 20 minutes later.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
      vi.stubEnv("OWNER_ALERTS_ENABLED", "true");
      vi.stubEnv("ALERTS_WHATSAPP_PHONE_ID", "106540352242922");
      vi.stubEnv("ALERTS_WHATSAPP_TOKEN", "alerts-token");
      db.prefs = { lead_alerts: true };
    });

    it("alerts once for the new lead, and a re-sync sends nothing", async () => {
      const whatsapp: unknown[] = [];
      replay(undefined, undefined, whatsapp);
      const first = await run();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ ok: true, imported: 1, businesses: [{ businessId, imported: 1, alerts: { sent: 1, skipped: {} } }] });
      expect(whatsapp).toEqual([{
        messaging_product: "whatsapp", recipient_type: "individual", to: "919999999001", type: "template",
        template: { name: "adbrain_lead_alert", language: { code: "en" }, components: [{ type: "body", parameters: [
          { type: "text", text: "Solaride" },
          { type: "text", text: "<test lead: dummy data for full_name>" },
          { type: "text", text: expect.stringMatching(/^(\+91 \d{5} \d{5}|\+?\d+|not given)$/) },
          { type: "text", text: expect.any(String) },
          { type: "text", text: expect.any(String) },
        ] }] },
      }]);
      expect(db.sends).toEqual([{ id: 1, dedupe_key: testLead, state: "sent", wa_message_id: CLOUD_ACCEPTED.messages[0].id }]);

      const second = await run();
      expect(second.body).toMatchObject({ ok: true, imported: 0, businesses: [{ alerts: { sent: 0 } }] });
      expect(whatsapp).toHaveLength(1);
    });

    it("sends nothing for a lead older than 24 h, or when the owner's lead alerts are off", async () => {
      const whatsapp: unknown[] = [];
      vi.setSystemTime(new Date("2026-10-23T05:40:00Z"));
      replay(undefined, undefined, whatsapp);
      expect((await run()).body).toMatchObject({ ok: true, imported: 1, businesses: [{ alerts: { sent: 0 } }] });
      db.leads.clear(); db.runs.clear();
      vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
      db.prefs = null;
      const off = await run();
      expect(off.body).toMatchObject({ ok: true, imported: 1 });
      expect(off.body.businesses[0].alerts).toBeUndefined();
      expect(whatsapp).toEqual([]);
    });

    it("an alert failure is reported but never fails the sync", async () => {
      db.failAlertReads = true;
      replay();
      const result = await run();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, imported: 1, businesses: [{ imported: 1, alerts: { error: "prefs" } }] });
      expect(db.sends).toEqual([]);
    });
  });
});
