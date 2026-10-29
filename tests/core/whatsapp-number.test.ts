import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-number.json";
import adSetCheck from "./fixtures/meta/whatsapp-adset-validate.json";
import refused from "./fixtures/meta/whatsapp-business-refused.json";

// #157: Solaride's Page has no published WhatsApp number, but its Meta business owns two
// WhatsApp Business Accounts whose numbers Meta accepts for the Page's WhatsApp ad sets
// (validate_only, whatsapp-adset-validate.json). Real read-only answers, digits replaced.
import { MetaClient } from "@/lib/meta/client";
import { readWhatsAppStatus } from "@/lib/meta/whatsapp-status";

const access = vi.hoisted(() => ({ requireOwnedBusiness: vi.fn(), getConnectionStatus: vi.fn(), withMetaConnection: vi.fn() }));
vi.mock("@/lib/meta/connection-access", () => access);

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };

function replay(tape: { path: string; status: number; body: unknown }[] = recorded.tape) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("access_token");
    const path = decodeURIComponent(url.pathname.replace("/v26.0/", "") + url.search);
    calls.push(path);
    if (path === `${creds.pageId}?fields=access_token`) return Response.json({ access_token: "page-token" });
    const exchange = tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());
const both = ["+919999994842", "+919999990874"];

describe("core: WhatsApp button number against recorded Graph reads (#157)", () => {
  it("has Meta's validate_only acceptance of the Page's WhatsApp ad set with either business number, in either format", () => {
    const adSets = adSetCheck.tape.filter((entry) => entry.name.startsWith("adset-"));
    expect(adSets.map((entry) => entry.name).sort()).toEqual(["adset-0874-digits", "adset-0874-plus", "adset-4842-digits", "adset-4842-plus"]);
    for (const entry of adSets) {
      expect(entry).toMatchObject({ status: 200, body: { success: true } });
      expect(JSON.parse(entry.form?.promoted_object ?? "{}")).toMatchObject({ page_id: creds.pageId });
      expect(entry.form).toMatchObject({ destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS", status: "PAUSED" });
    }
    expect(adSetCheck.tape.at(-1)).toMatchObject({ name: "campaign-delete", status: 200 });
  });
  it("accepts a number on a WhatsApp Business Account of the ad account's own business when the Page shows none", async () => {
    expect(recorded.tape[0].body).not.toHaveProperty("whatsapp_number");
    for (const number of ["+919999994842", "+919999990874"]) {
      replay();
      expect(await new MetaClient(creds).getWhatsAppNumber(number, [number])).toBe(number);
      vi.restoreAllMocks();
    }
  });

  it("lists the numbers WhatsApp chat ads can use: none on the Page, both business WhatsApp numbers (#235)", async () => {
    replay();
    expect(await new MetaClient(creds).whatsappNumbers()).toEqual({ page: null, business: ["+919999994842", "+919999990874"] });
  });

  it("refuses a number the business does not own, and keeps the Page-only rule when no number is requested", async () => {
    replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+919876543210", ["+919876543210"])).toBeNull();
    vi.restoreAllMocks();
    const calls = replay();
    expect(await new MetaClient(creds).getWhatsAppNumber(null, both)).toBeNull();
    expect(calls.some((path) => path.includes("owned_whatsapp_business_accounts"))).toBe(false);
  });

  it("refuses another AdBrain business's number on the same Meta business; accepts this business's own binding (#253)", async () => {
    // Business A has 0874 bound; business B has 4842. Both numbers sit on WABAs of the one Meta business.
    const businessA = ["+919999990874"];
    for (const asked of ["+919999994842", "+91 ••••• 4842"]) {
      replay();
      expect(await new MetaClient(creds).getWhatsAppNumber(asked, businessA)).toBeNull();
      vi.restoreAllMocks();
    }
    for (const asked of ["+919999990874", "+91 ••••• 0874"]) {
      replay();
      expect(await new MetaClient(creds).getWhatsAppNumber(asked, businessA)).toBe("+919999990874");
      vi.restoreAllMocks();
    }
    // With nothing bound, only the Page's own number could pass, and the business's WABAs aren't even read.
    const calls = replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+919999994842", [])).toBeNull();
    expect(calls.some((path) => path.includes("owned_whatsapp_business_accounts"))).toBe(false);
  });

  it("lets only masked numbers leave the server (#235)", async () => {
    replay();
    access.requireOwnedBusiness.mockResolvedValue({});
    access.getConnectionStatus.mockResolvedValue({ selected: {}, capabilities: { canCreatePaused: { state: "available" } } });
    access.withMetaConnection.mockImplementation((_context, _options, run: (meta: MetaClient) => unknown) => run(new MetaClient(creds)));
    const status = await readWhatsAppStatus("11111111-1111-4111-8111-111111111111");
    expect(status).toEqual({ state: "ready", numbers: [
      { masked: "+91 ••••• 4842", source: "business" },
      { masked: "+91 ••••• 0874", source: "business" },
    ] });
    expect(JSON.stringify(status)).not.toContain("9999");
    // #1540: Settings/Brand's number read is gated like a launch but logged as its own event, not meta.create_paused.
    expect(access.withMetaConnection).toHaveBeenCalledWith(expect.anything(), { purpose: "create_paused", event: "whatsapp_numbers" }, expect.any(Function));
  });

  it("resolves a masked choice to the one number behind it, and refuses unknown or shared masks (#235)", async () => {
    replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", both)).toBe("+919999994842");
    vi.restoreAllMocks();
    replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 1234", both)).toBeNull();
    vi.restoreAllMocks();
    // Same reads, with the second account's number changed to share 4842's mask.
    const tape: { path: string; status: number; body: unknown }[] = structuredClone(recorded.tape);
    const wabas = tape.find((entry) => entry.path.includes("owned_whatsapp_business_accounts"))!.body as { data: { phone_numbers: { data: { display_phone_number: string }[] } }[] };
    wabas.data[1].phone_numbers.data[0].display_phone_number = "+91 88888 84842";
    replay(tape);
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", [...both, "+918888884842"])).toBeNull();
  });

  it("starts the Page and business lookups together for a masked choice (#366)", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    replay();
    const replayed = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      started.push(new URL(String(input)).pathname);
      await gate;
      return replayed(input, init);
    });
    const result = new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", both);
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining([`/v26.0/${creds.pageId}`, `/v26.0/${creds.adAccountId}`])));
    release();
    expect(await result).toBe("+919999994842");
  });

  it("keeps the Page's number and the status card when Meta refuses the business's WhatsApp accounts (#615)", async () => {
    // Recorded: a token without WhatsApp access on the business edge gets HTTP 403, code 200.
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 200, type: "OAuthException" } } });
    const tape: { path: string; status: number; body: unknown }[] = structuredClone(recorded.tape).map((entry) => entry.path.includes("owned_whatsapp_business_accounts")
      ? { ...entry, status: refused.status, body: refused.body } : entry);
    const page = tape.find((entry) => entry.path.startsWith(`${creds.pageId}?fields=id,has_whatsapp_business_number`))!;
    page.body = { ...(page.body as object), has_whatsapp_business_number: true, whatsapp_number: "+91 99999 91111" };
    replay(tape);
    expect(await new MetaClient(creds).whatsappNumbers()).toEqual({ page: "+919999991111", business: [] });
    vi.restoreAllMocks();
    replay(tape);
    // A bound business number can't be confirmed, so it isn't used; the Page's own still is.
    expect(await new MetaClient(creds).getWhatsAppNumber("+919999994842", both)).toBeNull();
    vi.restoreAllMocks();
    replay(tape);
    access.requireOwnedBusiness.mockResolvedValue({});
    access.getConnectionStatus.mockResolvedValue({ selected: {}, capabilities: { canCreatePaused: { state: "available" } } });
    access.withMetaConnection.mockImplementation((_context, _options, run: (meta: MetaClient) => unknown) => run(new MetaClient(creds)));
    expect(await readWhatsAppStatus("11111111-1111-4111-8111-111111111111")).toEqual({ state: "ready", numbers: [{ masked: "+91 ••••• 1111", source: "page" }] });
  });

  it("still fails the read on any other Meta error, such as an expired token (#615)", async () => {
    const tape = recorded.tape.map((entry) => entry.path.includes("owned_whatsapp_business_accounts")
      ? { ...entry, status: 400, body: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } } : entry);
    replay(tape);
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toMatchObject({ code: 190 });
  });

  // #1199: production Oct 28 06:52Z, this exact GET hit the 15 s timeout and the whole Launch failed.
  const WABA = "owned_whatsapp_business_accounts";
  function flaky(failures: (() => never)[]) {
    const calls = replay();
    const recordedFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    let left = [...failures];
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).includes(WABA) && left.length) { calls.push(WABA); const fail = left[0]; left = left.slice(1); fail(); }
      return recordedFetch(input, init);
    });
    return calls;
  }
  const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
  const network = () => { throw new TypeError("fetch failed"); };

  // The launch worker always runs under a job deadline (worker.ts: 8 min).
  const job = () => new AbortController().signal;

  it("#1199: retries a read-only GET once after a timeout (under a job deadline) or a network error, so Launch's number check succeeds", async () => {
    for (const fail of [timeout, network]) {
      const calls = flaky([fail]);
      expect(await new MetaClient(creds, job()).getWhatsAppNumber("+919999994842", ["+919999994842"])).toBe("+919999994842");
      expect(calls.filter((path) => path.includes(WABA))).toHaveLength(2);
      vi.restoreAllMocks();
    }
  });

  it("#1199: retries a GET once on a Meta 5xx, and only once", async () => {
    replay(recorded.tape.map((entry) => entry.path.includes(WABA) ? { ...entry, status: 500, body: { error: { message: "An unknown error has occurred.", type: "OAuthException", code: 1, is_transient: true } } } : entry));
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toMatchObject({ status: 500 });
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url).includes(WABA))).toHaveLength(2);
  });

  it("#1199: two timeouts in a row still fail; the caller's own abort is never retried", async () => {
    flaky([timeout, timeout]);
    await expect(new MetaClient(creds, job()).whatsappNumbers()).rejects.toMatchObject({ name: "TimeoutError" });
    vi.restoreAllMocks();
    const stop = new AbortController();
    stop.abort(new DOMException("Execution budget spent", "TimeoutError"));
    flaky([timeout]);
    await expect(new MetaClient(creds, stop.signal).whatsappNumbers()).rejects.toBeDefined();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);
  });

  it("#1199: without a job deadline (a 60 s route), a timeout is not repeated; a network error still is", async () => {
    const calls = flaky([timeout]);
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(calls.filter((path) => path.includes(WABA))).toHaveLength(1);
    vi.restoreAllMocks();
    flaky([network]);
    expect(await new MetaClient(creds).whatsappNumbers()).toEqual({ page: null, business: both });
  });

  it("#1199: never retries a POST (it may have been done)", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
    const graph = (client: MetaClient) => (client as unknown as { graph(path: string, opts: { method: string; form: Record<string, string> }): Promise<unknown> }).graph;
    const client = new MetaClient(creds);
    await expect(graph(client).call(client, "120000000000000001", { method: "POST", form: { status: "PAUSED" } })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
