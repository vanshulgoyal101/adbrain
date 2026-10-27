import { afterEach, describe, expect, it, vi } from "vitest";
import { AdSetSwitchStuckError, CampaignDeliveryError, MetaClient } from "@/lib/meta/client";

// #765 (b): the switch's safety rules, on a scripted Graph (the recorded tapes replay the happy path).
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const CAMPAIGN = "900000000000000003", OLD = "900000000000000004", NEW = "900000000000000006", ADS = ["900000000000000007", "900000000000000008"];

type Node = { id: string; campaign_id: string; status: string; lifetime_budget?: string; budget_remaining?: string };
function graph(options: { capped?: { lifetime: string; remaining: string; remainingAtSwitch: string }; failOn?: (method: string, id: string, form: Record<string, string>) => boolean; failRestore?: boolean } = {}) {
  const nodes = new Map<string, Node>([
    [OLD, { id: OLD, campaign_id: CAMPAIGN, status: "ACTIVE", ...options.capped ? { lifetime_budget: options.capped.lifetime, budget_remaining: options.capped.remaining } : { lifetime_budget: "0" } }],
    [NEW, { id: NEW, campaign_id: CAMPAIGN, status: "PAUSED", ...options.capped ? { lifetime_budget: options.capped.remaining } : { lifetime_budget: "0" } }],
    ...ADS.map(id => [id, { id, campaign_id: CAMPAIGN, status: "PAUSED" }] as [string, Node]),
  ]);
  const writes: Array<{ id: string; form: Record<string, string> }> = [];
  const activeAfterEachWrite: string[][] = [];
  let restoring = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const [id, edge] = url.pathname.split("/").slice(2);
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (edge === "ads") return Response.json({ data: ADS.map(ad => ({ id: ad, status: nodes.get(ad)!.status, adset_id: NEW })) });
      return Response.json(nodes.get(id));
    }
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    writes.push({ id, form });
    if (form.status === "PAUSED" && id === NEW) restoring = true;
    if ((restoring && options.failRestore) || options.failOn?.(method, id, form)) return Response.json({ error: { message: "Refused", code: 100 } }, { status: 400 });
    if (method === "DELETE") { nodes.delete(id); return Response.json({ success: true }); }
    if (!form.execution_options) {
      const node = nodes.get(id)!;
      if (form.status) node.status = form.status;
      if (form.lifetime_budget) node.lifetime_budget = form.lifetime_budget;
      if (id === OLD && form.status === "PAUSED" && options.capped) node.budget_remaining = options.capped.remainingAtSwitch;
    }
    activeAfterEachWrite.push(active());
    return Response.json({ success: true });
  });
  function active() { return [...nodes.values()].filter(node => (node.id === OLD || node.id === NEW) && node.status === "ACTIVE").map(node => node.id); }
  return { nodes, writes, activeAfterEachWrite };
}
const switchInput = { fromAdSetId: OLD, toAdSetId: NEW, toAdIds: ADS };

afterEach(() => vi.restoreAllMocks());

describe("core: switch a running ad set to its new-audience copy (#765 b)", () => {
  it("checks the copy's activation first, pauses the old ad set before anything goes ACTIVE, then archives it", async () => {
    const meta = graph();
    expect(await new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).toEqual({ fromAdSetId: OLD, adSetId: NEW, adIds: ADS });
    expect(meta.writes.map(write => `${write.id}:${write.form.status}${write.form.execution_options ? ":validate" : ""}`)).toEqual([
      `${NEW}:ACTIVE:validate`, `${OLD}:PAUSED`, `${ADS[0]}:ACTIVE`, `${ADS[1]}:ACTIVE`, `${NEW}:ACTIVE`, `${OLD}:ARCHIVED`,
    ]);
    expect(meta.nodes.get(NEW)!.status).toBe("ACTIVE");
  });

  it("never has two ACTIVE ad sets, at any write", async () => {
    const meta = graph();
    await new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput);
    expect(meta.activeAfterEachWrite.length).toBeGreaterThan(4);
    expect(meta.activeAfterEachWrite.every(active => active.length <= 1)).toBe(true);
  });

  it("writes nothing when Meta won't activate the copy", async () => {
    const meta = graph({ failOn: (_method, id, form) => id === NEW && Boolean(form.execution_options) });
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).rejects.toThrow("Refused");
    expect(meta.writes.filter(write => !write.form.execution_options)).toEqual([]);
    expect(meta.nodes.get(OLD)!.status).toBe("ACTIVE");
  });

  it("resumes the old ad set and re-pauses the copy when activation fails after the pause", async () => {
    const meta = graph({ failOn: (_method, id, form) => id === NEW && form.status === "ACTIVE" && !form.execution_options });
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).rejects.toSatisfy((error: unknown) =>
      error instanceof CampaignDeliveryError && !(error instanceof AdSetSwitchStuckError) && error.message === "Refused. The old audience is running again.");
    expect(meta.nodes.get(OLD)!.status).toBe("ACTIVE");
    expect(meta.nodes.get(NEW)!.status).toBe("PAUSED");
    expect(meta.writes.some(write => write.form.status === "ARCHIVED")).toBe(false);
  });

  it("says the switch is stuck when the old ad set can't be resumed", async () => {
    graph({ failOn: (_method, id, form) => id === NEW && form.status === "ACTIVE" && !form.execution_options, failRestore: true });
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).rejects.toBeInstanceOf(AdSetSwitchStuckError);
  });

  // CTO condition 2: the copy doesn't reset the cap. What the old ad set spent while the copy waited comes off.
  it("cuts a capped copy's total to what the old ad set has left at the switch", async () => {
    const meta = graph({ capped: { lifetime: "500000", remaining: "300000", remainingAtSwitch: "260000" } });
    await new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput);
    expect(meta.nodes.get(NEW)!.lifetime_budget).toBe("260000");
    const order = meta.writes.map(write => write.form.lifetime_budget ? "cut" : `${write.id}:${write.form.status}${write.form.execution_options ? ":validate" : ""}`);
    expect(order.indexOf("cut")).toBeGreaterThan(order.indexOf(`${OLD}:PAUSED`));
    expect(order.indexOf("cut")).toBeLessThan(order.indexOf(`${NEW}:ACTIVE`));
    expect(order.indexOf(`${NEW}:ACTIVE:validate`)).toBe(0);
  });

  it("refuses to switch a capped run that has spent its total, and resumes the old ad set", async () => {
    const meta = graph({ capped: { lifetime: "500000", remaining: "10000", remainingAtSwitch: "0" } });
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).rejects.toThrow("spent its total");
    expect(meta.nodes.get(NEW)!.status).toBe("PAUSED");
    expect(meta.nodes.get(OLD)!.status).toBe("ACTIVE");
  });

  it("refuses before any write when the copy isn't paused or the old ad set isn't running", async () => {
    const meta = graph();
    meta.nodes.get(NEW)!.status = "ACTIVE";
    await expect(new MetaClient(creds).switchAdSet(CAMPAIGN, switchInput)).rejects.toThrow("Nothing changed.");
    expect(meta.writes).toEqual([]);
  });

  it("cancel deletes only the paused copy and never writes the running ad set", async () => {
    const meta = graph();
    await new MetaClient(creds).deleteAdSetCopy(CAMPAIGN, NEW);
    expect(meta.writes).toEqual([{ id: NEW, form: {} }]);
    expect(meta.nodes.has(NEW)).toBe(false);
    expect(meta.nodes.get(OLD)!.status).toBe("ACTIVE");
    await expect(new MetaClient(creds).deleteAdSetCopy(CAMPAIGN, OLD)).rejects.toThrow("Nothing was deleted.");
  });
});
