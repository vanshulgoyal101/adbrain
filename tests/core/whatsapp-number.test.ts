import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-number.json";
import adSetCheck from "./fixtures/meta/whatsapp-adset-validate.json";
import refused from "./fixtures/meta/whatsapp-business-refused.json";
import rateLimited from "./fixtures/meta/whatsapp-number-rate-limited.json";

// #157: Solaride's Page has no published WhatsApp number, but its Meta business owns two
// WhatsApp Business Accounts whose numbers Meta accepts for the Page's WhatsApp ad sets
// (validate_only, whatsapp-adset-validate.json). Real read-only answers, digits replaced.
import { MetaClient } from "@/lib/meta/client";
import { readWhatsAppStatus } from "@/lib/meta/whatsapp-status";
import { readBusinessWhatsAppNumbers } from "@/lib/meta/whatsapp-numbers";
import { goLive, type GoLiveDeps } from "@/lib/campaign/setup-go-live-flow";

const limiter = vi.hoisted(() => ({ rateLimitResponse: vi.fn(async () => null) }));
vi.mock("@/lib/security/rate-limit", () => limiter);

const access = vi.hoisted(() => ({ requireOwnedBusiness: vi.fn(), getConnectionStatus: vi.fn(), withMetaConnection: vi.fn() }));
vi.mock("@/lib/meta/connection-access", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/meta/connection-access")>()), ...access }));

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const BUSINESS = "11111111-1111-4111-8111-111111111111";
const WABA = "owned_whatsapp_business_accounts";
const PAGE = `${creds.pageId}?fields=id,has_whatsapp_business_number`;
const ACCOUNT = `${creds.adAccountId}?fields=id,business`;
const SECRET = "test-meta-app-secret-for-choices";

function replay(tape: { path: string; status: number; body: unknown }[] = recorded.tape) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("access_token");
    url.searchParams.delete("appsecret_proof");
    const path = decodeURIComponent(url.pathname.replace("/v26.0/", "") + url.search);
    calls.push(path);
    if (path === `${creds.pageId}?fields=access_token`) return Response.json({ access_token: "page-token" });
    const exchange = tape.find((entry) => entry.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return calls;
}

function allowWhatsAppRead() {
  access.requireOwnedBusiness.mockResolvedValue({ userId: "u1" });
  access.getConnectionStatus.mockResolvedValue({ selected: {}, capabilities: { canCreatePaused: { state: "available" } } });
  access.withMetaConnection.mockImplementation((_context, _options, run: (meta: MetaClient) => unknown) => run(new MetaClient(creds)));
}

async function goLiveThroughWhatsAppRoute(allowPlan = false) {
  const { GET } = await import("@/app/api/meta/whatsapp/route");
  const statuses: number[] = [];
  const fetchRoute = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (allowPlan && url.pathname === "/api/campaigns/plan") {
      return Response.json({ ready: true, targeting: {
        age: { mode: "manual", min: 25, max: 55 },
        audience: { interestNames: ["Local services"], rationale: "Local customers" },
      } });
    }
    if (url.pathname !== "/api/meta/whatsapp") throw new Error(`Unexpected request: ${url.pathname}`);
    const response = await GET(new Request(url, init));
    statuses.push(response.status);
    return response;
  });
  const client: GoLiveDeps["client"] = {
    status: vi.fn().mockResolvedValue({
      authorization: "connected", selected: {}, capabilities: { canActivate: { state: "available" } },
    }),
    saveDraft: vi.fn().mockResolvedValue({ draftId: "draft", version: 1 }),
    preflight: vi.fn().mockResolvedValue({ canCreatePaused: false, blockers: [{ message: "Review stopped" }], planHash: null }),
    createCampaign: vi.fn(), operation: vi.fn(), operationForRequest: vi.fn(),
  };
  const result = await goLive({ client, fetch: fetchRoute, storage: null }, {
    businessId: BUSINESS, businessName: "Test business", ads: [{ id: "ad" }], dailyBudgetRupees: 200, capDays: 2,
  });
  return { result, statuses, fetchRoute, client };
}

beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const both = ["+919999994842", "+919999990874"];

describe("core: WhatsApp button number against recorded Graph reads (#157)", () => {
  it("uses a stable, tenant-scoped opaque identity without exposing the full numbers", async () => {
    allowWhatsAppRead();
    replay();
    const first = await readWhatsAppStatus(BUSINESS);
    const again = await readWhatsAppStatus(BUSINESS);
    const other = await readWhatsAppStatus("22222222-2222-4222-8222-222222222222");
    expect(first.state).toBe("ready");
    expect(again).toEqual(first);
    if (first.state !== "ready" || other.state !== "ready") throw new Error("Recorded numbers were not ready.");
    expect(first.numbers.every((choice) => /^[a-f0-9]{64}$/.test(choice.choiceId))).toBe(true);
    expect(first.numbers.map((choice) => choice.choiceId)).not.toEqual(other.numbers.map((choice) => choice.choiceId));
    expect(JSON.stringify(first)).not.toContain("999999");
  });

  it("fails closed when the secret for an opaque number choice is unavailable", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    allowWhatsAppRead();
    replay();
    const { GET } = await import("@/app/api/meta/whatsapp/route");
    const response = await GET(new Request(`http://localhost/api/meta/whatsapp?businessId=${BUSINESS}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ state: "unavailable" });
  });

  it("keeps a distinct Page usable when business choices cannot be distinguished", async () => {
    const tape = recorded.tape.map((entry) => {
      if (entry.path.includes(PAGE)) {
        return { ...entry, body: { id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: "+91 99999 91111" } };
      }
      if (entry.path.includes(WABA)) {
        return { ...entry, body: { data: [
          { id: "123", phone_numbers: { data: [{ display_phone_number: "+91 88888 82222" }] } },
          { id: "456", phone_numbers: { data: [{ display_phone_number: "+91 77777 72222" }] } },
        ] } };
      }
      return entry;
    });
    allowWhatsAppRead();
    replay(tape);
    const status = await readWhatsAppStatus(BUSINESS);
    expect(status).toMatchObject({ state: "ready", numbers: [{ masked: "+91 ••••• 1111", source: "page" }], businessUnavailable: true });
  });

  it("does not make the default Page an explicit owner selection when another number has the same mask", async () => {
    const tape = recorded.tape.map((entry) => entry.path.includes(PAGE)
      ? { ...entry, body: { id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: "+91 88888 84842" } }
      : entry);
    allowWhatsAppRead();
    replay(tape);
    const { result, statuses, client } = await goLiveThroughWhatsAppRoute(true);
    expect(statuses).toEqual([200]);
    expect(result).toEqual({ kind: "failed", message: "Choose your WhatsApp number in Campaigns. Nothing was spent." });
    expect(client.saveDraft).not.toHaveBeenCalled();
    expect(client.preflight).not.toHaveBeenCalled();
  });

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
    // With nothing bound, an unbound business number must not pass; its WABAs are still read to distinguish failure from absence.
    const calls = replay();
    expect(await new MetaClient(creds).getWhatsAppNumber("+919999994842", [])).toBeNull();
    expect(calls.some((path) => path.includes("owned_whatsapp_business_accounts"))).toBe(true);
  });

  it("lets only masked numbers leave the server (#235)", async () => {
    replay();
    access.requireOwnedBusiness.mockResolvedValue({});
    access.getConnectionStatus.mockResolvedValue({ selected: {}, capabilities: { canCreatePaused: { state: "available" } } });
    access.withMetaConnection.mockImplementation((_context, _options, run: (meta: MetaClient) => unknown) => run(new MetaClient(creds)));
    const status = await readWhatsAppStatus("11111111-1111-4111-8111-111111111111");
    expect(status).toEqual({ state: "ready", numbers: [
      { masked: "+91 ••••• 4842", source: "business", choiceId: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { masked: "+91 ••••• 0874", source: "business", choiceId: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ] });
    expect(JSON.stringify(status)).not.toContain("+919999994842");
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
    expect(await new MetaClient(creds).whatsappNumbers()).toEqual({ page: "+919999991111", business: [], businessUnavailable: true });
    vi.restoreAllMocks();
    replay(tape);
    // An unconfirmed business number is unknown, not proof that the number is unlinked.
    await expect(new MetaClient(creds).getWhatsAppNumber("+919999994842", both)).rejects.toMatchObject({ status: 403, code: 200 });
    vi.restoreAllMocks();
    replay(tape);
    // An explicitly selected Page remains usable without access to the business's WABAs.
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 1111", both, "page")).toBe("+919999991111");
    vi.restoreAllMocks();
    replay(tape);
    // Even an unbound business number might share the mask, so a legacy choice cannot be assumed to be the Page.
    await expect(new MetaClient(creds).getWhatsAppNumber("+91 ••••• 1111", [])).rejects.toMatchObject({ status: 403, code: 200 });
    vi.restoreAllMocks();
    replay(tape);
    await expect(new MetaClient(creds).getWhatsAppNumber("+91 ••••• 1111", [], "business")).rejects.toMatchObject({ status: 403, code: 200 });
    vi.restoreAllMocks();
    replay(tape);
    access.requireOwnedBusiness.mockResolvedValue({});
    access.getConnectionStatus.mockResolvedValue({ selected: {}, capabilities: { canCreatePaused: { state: "available" } } });
    access.withMetaConnection.mockImplementation((_context, _options, run: (meta: MetaClient) => unknown) => run(new MetaClient(creds)));
    expect(await readWhatsAppStatus("11111111-1111-4111-8111-111111111111")).toEqual({
      state: "ready", numbers: [{ masked: "+91 ••••• 1111", source: "page", choiceId: expect.stringMatching(/^[a-f0-9]{64}$/) }], businessUnavailable: true,
    });
  });

  it("refuses a changed Page before any Meta write, even if its old number remains on a bound WABA", async () => {
    const oldPage = "+919999991111";
    const tape = recorded.tape.map((entry) => {
      if (entry.path.includes(PAGE)) return { ...entry, body: { id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: "+91 88888 82222" } };
      if (entry.path.includes(WABA)) return { ...entry, body: { data: [{ id: "123", phone_numbers: { data: [{ display_phone_number: oldPage }] } }] } };
      return entry;
    });
    replay(tape);
    await expect(new MetaClient(creds).createLeadCampaign({
      name: "Chats", dailyBudgetRupees: 300, link: "https://example.com", creatives: [],
      location: { countries: ["IN"] }, ageMin: 25, ageMax: 55, destination: "whatsapp",
      whatsappNumber: oldPage, whatsappNumberSource: "page", boundWhatsAppNumbers: [oldPage],
    })).rejects.toThrow("The Page-linked WhatsApp number changed. Review the campaign again.");
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([, options]) => (options?.method ?? "GET") === "GET")).toBe(true);
  });

  it("does not mistake an unbound business number sharing the Page's mask for the Page", async () => {
    const tape: { path: string; status: number; body: unknown }[] = structuredClone(recorded.tape);
    const page = tape.find((entry) => entry.path.includes(PAGE))!;
    page.body = { id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: "+91 88888 84842" };
    replay(tape);
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", [])).toBeNull();
    vi.restoreAllMocks();
    replay(tape);
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", [], "page")).toBe("+918888884842");
    vi.restoreAllMocks();
    replay(tape);
    expect(await new MetaClient(creds).getWhatsAppNumber("+91 ••••• 4842", ["+919999994842"], "business")).toBe("+919999994842");
  });

  it.each([
    { has_whatsapp_business_number: true },
    { whatsapp_number: "+91 99999 91111" },
  ])("rejects an incomplete Page read during Review instead of reporting it unlinked: %o", async (page) => {
    replay(recorded.tape.map((entry) => entry.path.includes(PAGE)
      ? { ...entry, body: { id: creds.pageId, ...page } } : entry));
    await expect(new MetaClient(creds).getWhatsAppNumber(null, [])).rejects.toThrow("WhatsApp Page number could not be read");
  });

  it("reads outer WABA and nested phone pages through bounded Graph cursors, not paging URLs", async () => {
    const tape: { path: string; status: number; body: unknown }[] = structuredClone(recorded.tape);
    const waba = tape.find((entry) => entry.path.includes(WABA))!;
    const existing = waba.body as { data: { id: string; phone_numbers: { data: unknown[] } }[] };
    const [first, second] = existing.data;
    waba.body = {
      data: [{ ...first, phone_numbers: {
        ...first.phone_numbers, paging: { next: "https://untrusted.invalid/phones", cursors: { after: "phone2" } },
      } }],
      paging: { next: "https://untrusted.invalid/wabas", cursors: { after: "outer2" } },
    };
    tape.push(
      { path: `${waba.path}&after=outer2`, status: 200, body: { data: [second] } },
      { path: `${first.id}/phone_numbers?fields=display_phone_number&limit=100&after=phone2`, status: 200,
        body: { data: [{ display_phone_number: "+91 99999 92222" }] } },
    );
    const calls = replay(tape);
    expect(await new MetaClient(creds).whatsappNumbers()).toEqual({
      page: null, business: ["+919999994842", "+919999992222", "+919999990874"],
    });
    expect(calls).toContain(`${waba.path}&after=outer2`);
    expect(calls).toContain(`${first.id}/phone_numbers?fields=display_phone_number&limit=100&after=phone2`);
    expect(calls.every((path) => !path.includes("untrusted.invalid"))).toBe(true);
  });

  it.each(["outer", "phone"] as const)("rejects a repeating %s cursor without looping", async (level) => {
    const tape: { path: string; status: number; body: unknown }[] = structuredClone(recorded.tape);
    const waba = tape.find((entry) => entry.path.includes(WABA))!;
    const existing = waba.body as { data: { id: string; phone_numbers: { data: unknown[] } }[] };
    const paging = { next: "https://untrusted.invalid/next", cursors: { after: "repeat" } };
    if (level === "outer") {
      waba.body = { data: [], paging };
      tape.push({ path: `${waba.path}&after=repeat`, status: 200, body: { data: [], paging } });
    } else {
      const first = existing.data[0];
      waba.body = { data: [{ ...first, phone_numbers: { data: first.phone_numbers.data, paging } }] };
      tape.push({ path: `${first.id}/phone_numbers?fields=display_phone_number&limit=100&after=repeat`, status: 200, body: { data: [], paging } });
    }
    const calls = replay(tape);
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toThrow("cursor");
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("bounds total WABA and phone-page requests", async () => {
    let calls = 0;
    await expect(readBusinessWhatsAppNumbers("123", async () => {
      calls++;
      return { data: [], paging: { next: "https://untrusted.invalid/next", cursors: { after: `cursor${calls}` } } };
    })).rejects.toThrow("page limit exceeded");
    expect(calls).toBe(20);
  });

  it("does not treat an empty next link as a complete WABA response", async () => {
    replay(recorded.tape.map((entry) => entry.path.includes(WABA)
      ? { ...entry, body: { data: [], paging: { next: "" } } } : entry));
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toThrow();
  });

  it("still fails the read on any other Meta error, such as an expired token (#615)", async () => {
    const tape = recorded.tape.map((entry) => entry.path.includes("owned_whatsapp_business_accounts")
      ? { ...entry, status: 400, body: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } } : entry);
    replay(tape);
    await expect(new MetaClient(creds).whatsappNumbers()).rejects.toMatchObject({ code: 190 });
  });

  it("#2841: a Meta rate limit (80008, HTTP 400, as seen Nov 3) is 'busy' (429) through the route, never a zero-number answer", async () => {
    const tape = recorded.tape.map((entry) => entry.path.includes(WABA) ? { ...entry, status: rateLimited.status, body: rateLimited.body } : entry);
    allowWhatsAppRead();
    const { GET } = await import("@/app/api/meta/whatsapp/route");
    const ask = () => GET(new Request(`http://localhost/api/meta/whatsapp?businessId=${BUSINESS}`));
    replay(tape);
    const answer = await ask();
    expect({ status: answer.status, body: await answer.json() }).toEqual({ status: 429, body: { state: "busy" } });
    vi.restoreAllMocks();
    // A real "no number linked" answer stays a distinct, successful not_linked.
    replay(recorded.tape.map((entry) => entry.path.includes(WABA) ? { ...entry, body: { data: [] } } : entry));
    const empty = await ask();
    expect({ status: empty.status, body: await empty.json() }).toEqual({ status: 200, body: { state: "not_linked" } });
  });

  it.each([
    {
      name: "the incident-derived Meta 80008 throttle",
      target: WABA, reply: rateLimited, expectedStatus: 429,
      message: "Meta is busy. Nothing was spent. Try again in a minute.",
    },
    {
      name: "a provider HTTP 429 without a Graph error code",
      target: WABA, reply: { status: 429, body: { error: { message: "Rate limited" } } }, expectedStatus: 429,
      message: "Meta is busy. Nothing was spent. Try again in a minute.",
    },
    {
      name: "a provider HTTP 429 with a JSON null body",
      target: WABA, reply: { status: 429, body: null }, expectedStatus: 429,
      message: "Meta is busy. Nothing was spent. Try again in a minute.",
    },
    {
      name: "the recorded WABA permission refusal with no Page number",
      target: WABA, reply: refused, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an expired Meta token",
      target: WABA, reply: { status: 400, body: { error: { code: 190, message: "Token expired" } } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a provider server error",
      target: WABA, reply: { status: 500, body: { error: { code: 1, message: "Unavailable" } } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a WABA list without data",
      target: WABA, reply: { status: 200, body: {} }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an incomplete WABA list",
      target: WABA, reply: { status: 200, body: { data: [], paging: { next: "https://example.com/next" } } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an invalid WABA cursor",
      target: WABA, reply: { status: 200, body: { data: [], paging: { next: "https://untrusted.invalid", cursors: { after: "../../invalid" } } } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an incomplete nested phone list",
      target: WABA, reply: { status: 200, body: { data: [{ phone_numbers: { data: [], paging: { next: "https://example.com/next" } } }] } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a WABA without a phone-number result",
      target: WABA, reply: { status: 200, body: { data: [{ id: "waba" }] } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an invalid returned phone number",
      target: WABA, reply: { status: 200, body: { data: [{ phone_numbers: { data: [{ display_phone_number: "invalid" }] } }] } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a phone entry without a display number",
      target: WABA, reply: { status: 200, body: { data: [{ phone_numbers: { data: [{ id: "phone" }] } }] } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a response for another Page",
      target: PAGE, reply: { status: 200, body: { id: "other" } }, emptyWaba: true, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "a Page reporting a number without returning it",
      target: PAGE, reply: { status: 200, body: { id: creds.pageId, has_whatsapp_business_number: true } }, emptyWaba: true, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an unreadable ad-account response",
      target: ACCOUNT, reply: { status: 200, body: {} }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
    {
      name: "an invalid ad-account business identifier",
      target: ACCOUNT, reply: { status: 200, body: { id: creds.adAccountId, business: { id: "invalid" } } }, expectedStatus: 503,
      message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again.",
    },
  ])("#2841: $name stops Go live through the real route without saving", async ({ target, reply, emptyWaba, expectedStatus, message }) => {
    const tape = recorded.tape.map((entry) => {
      if (entry.path.includes(target)) return { ...entry, status: reply.status, body: reply.body };
      return emptyWaba && entry.path.includes(WABA) ? { ...entry, status: 200, body: { data: [] } } : entry;
    });
    allowWhatsAppRead();
    const calls = replay(tape);
    const { result, statuses, fetchRoute, client } = await goLiveThroughWhatsAppRoute();
    expect(statuses).toEqual([expectedStatus]);
    expect(result).toEqual({ kind: "failed", message });
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    if (expectedStatus === 429) expect(calls.filter((path) => path.includes(WABA))).toHaveLength(1);
    expect(client.saveDraft).not.toHaveBeenCalled();
    expect(client.preflight).not.toHaveBeenCalled();
    expect(client.createCampaign).not.toHaveBeenCalled();
  });

  it("#2841: a network failure during the Graph read stops Go live through the route", async () => {
    allowWhatsAppRead();
    replay();
    const recordedFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).includes(WABA)) throw new TypeError("fetch failed");
      return recordedFetch(input, init);
    });
    const { result, statuses, client } = await goLiveThroughWhatsAppRoute();
    expect(statuses).toEqual([503]);
    expect(result).toEqual({ kind: "failed", message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again." });
    expect(client.saveDraft).not.toHaveBeenCalled();
    expect(client.preflight).not.toHaveBeenCalled();
  });

  it("#2841: an ad account without a business is a genuine unlinked result", async () => {
    allowWhatsAppRead();
    replay(recorded.tape.map((entry) => entry.path.includes(ACCOUNT)
      ? { ...entry, body: { id: creds.adAccountId } } : entry));
    const { GET } = await import("@/app/api/meta/whatsapp/route");
    const answer = await GET(new Request(`http://localhost/api/meta/whatsapp?businessId=${BUSINESS}`));
    expect({ status: answer.status, body: await answer.json() }).toEqual({ status: 200, body: { state: "not_linked" } });
  });

  it("#2841: a genuinely empty WABA list proceeds with the WhatsApp destination and no number", async () => {
    allowWhatsAppRead();
    replay(recorded.tape.map((entry) => {
      if (entry.path.includes(WABA)) return { ...entry, body: { data: [] } };
      return entry;
    }));
    const { result, statuses, client } = await goLiveThroughWhatsAppRoute(true);
    expect(statuses).toEqual([200]);
    expect(result).toEqual({ kind: "blocked", messages: ["Review stopped"] });
    expect(client.saveDraft).toHaveBeenCalledOnce();
    const draft = vi.mocked(client.saveDraft).mock.calls[0][0];
    expect(draft.destination).toBe("whatsapp");
    expect(draft.whatsappNumber ?? "").toBe("");
    expect(draft.whatsappNumberSource).toBeUndefined();
    expect(client.preflight).toHaveBeenCalledOnce();
    expect(client.createCampaign).not.toHaveBeenCalled();
  });

  it.each([
    refused,
    { status: 403, body: { error: { code: 10 } } },
  ])("#2841: partial status never treats a verified Page as an explicit one-tap selection", async (waba) => {
    allowWhatsAppRead();
    replay(recorded.tape.map((entry) => {
      if (entry.path.includes(WABA)) return { ...entry, status: waba.status, body: waba.body };
      if (entry.path.includes(PAGE)) return { ...entry, body: { id: creds.pageId, has_whatsapp_business_number: true, whatsapp_number: "+91 99999 91111" } };
      return entry;
    }));
    const { result, statuses, client } = await goLiveThroughWhatsAppRoute(true);
    expect(statuses).toEqual([200]);
    expect(result).toEqual({ kind: "failed", message: "Couldn't check your WhatsApp number with Meta. Nothing was spent. Try again." });
    expect(client.saveDraft).not.toHaveBeenCalled();
    expect(client.preflight).not.toHaveBeenCalled();
    expect(client.createCampaign).not.toHaveBeenCalled();
  });

  // #1199: production Oct 28 06:52Z, this exact GET hit the 15 s timeout and the whole Launch failed.
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
