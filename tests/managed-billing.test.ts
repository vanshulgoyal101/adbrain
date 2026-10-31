import { describe, expect, it } from "vitest";
import { checkFunding, fundingFromMeta, invitePayer, type BillingDeps, type BillingRow } from "@/lib/meta/managed-billing";

/**
 * #2359. Funding reads use Meta's documented Ad Account shapes (`funding_source_details`, `account_status`)
 * until the QA 2 walk on the first internal child records the real ones (provisional, like #521's tests).
 */
const NO_CARD = { id: "act_7301", account_status: 1 };
const FS_NULL = { id: "act_7301", account_status: 1, funding_source_details: { id: "0", type: 14 } };
const CARD = { id: "act_7301", account_status: 1, funding_source_details: { id: "9101", display_string: "Visa *1234", type: 1 } };
const PREPAID = { id: "act_7301", account_status: 1, funding_source_details: { id: "9102", display_string: "Available balance", type: 20 } };
const GRACE = { ...CARD, account_status: 9 };

const ROW: BillingRow = {
  state: "ad_account_created", child_business_id: "7201", ad_account_id: "act_7301", manager_token_id: "tok-1",
  step_keys: { grant: "grant:b", page_grant: "page:b" }, whatsapp_number_e164: null,
};

function fake(options: { row?: BillingRow | null; members?: { id: string; email?: string }[]; pending?: { id: string; email?: string }[];
  assigned?: { id: string; tasks?: string[] }[]; funding?: unknown } = {}) {
  const calls: string[] = [];
  const writes: unknown[] = [];
  const deps: BillingDeps = {
    businessId: "b",
    row: async () => (options.row === undefined ? ROW : options.row),
    managerToken: async (id) => (id === "tok-1" ? "child-token" : null),
    update: async (values, whenState) => { writes.push(["update", values, whenState]); },
    event: async (values) => { writes.push(["event", values]); },
    graph: {
      get: async <T,>(path: string, token: string) => {
        calls.push(`GET ${path} ${token}`);
        if (path.startsWith("7201/business_users")) return { data: options.members ?? [] } as T;
        if (path.startsWith("7201/pending_users")) return { data: options.pending ?? [] } as T;
        if (path.startsWith("act_7301/assigned_users")) return { data: options.assigned ?? [] } as T;
        if (path.startsWith("act_7301?")) return (options.funding ?? NO_CARD) as T;
        throw new Error(`unexpected ${path}`);
      },
      post: async <T,>(path: string, form: Record<string, string>, token: string) => {
        calls.push(`POST ${path} ${JSON.stringify(form)} ${token}`);
        return { success: true } as T;
      },
    },
  };
  return { deps, calls, writes };
}

describe("funded only from Meta's read of the ad account (#2359)", () => {
  it("needs ACTIVE and a real payment method; a prepaid balance waits for the walk's recorded shape", () => {
    expect(fundingFromMeta(CARD)).toEqual({ funded: true });
    expect(fundingFromMeta(NO_CARD)).toEqual({ funded: false, reason: "NO_PAYMENT_METHOD" });
    expect(fundingFromMeta(FS_NULL)).toEqual({ funded: false, reason: "NO_PAYMENT_METHOD" });
    expect(fundingFromMeta({ ...CARD, funding_source_details: { id: "0", type: 0 } })).toEqual({ funded: false, reason: "NO_PAYMENT_METHOD" });
    expect(fundingFromMeta({ ...CARD, funding_source_details: { id: "9101" } })).toEqual({ funded: false, reason: "NO_PAYMENT_METHOD" });
    expect(fundingFromMeta(PREPAID)).toEqual({ funded: false, reason: "PREPAID_UNCONFIRMED" });
    expect(fundingFromMeta(GRACE)).toEqual({ funded: false, reason: "IN_GRACE_PERIOD" });
    expect(fundingFromMeta({ ...CARD, account_status: 3 })).toEqual({ funded: false, reason: "PAYMENT_DUE" });
    expect(fundingFromMeta({ ...CARD, account_status: 7 })).toEqual({ funded: false, reason: "PENDING_REVIEW" });
    expect(fundingFromMeta({ ...NO_CARD, account_status: 2 })).toEqual({ funded: false, reason: "ACCOUNT_DISABLED" });
    expect(fundingFromMeta({ ...CARD, account_status: 101 })).toEqual({ funded: false, reason: "ACCOUNT_CLOSED" });
    expect(fundingFromMeta({ funding_source_details: CARD.funding_source_details })).toEqual({ funded: false, reason: "ACCOUNT_NOT_ACTIVE" });
  });

  it("counts only payment methods the customer adds themselves; a shared credit line or invoice, or an unknown type, fails closed", () => {
    for (const type of [1, 12, 13, 17, 19]) expect(fundingFromMeta({ ...CARD, funding_source_details: { id: "9103", type } })).toEqual({ funded: true });
    for (const type of [4, 6, 99]) {
      expect(fundingFromMeta({ ...CARD, funding_source_details: { id: "9104", type } })).toEqual({ funded: false, reason: "NOT_OWN_PAYMENT_METHOD" });
    }
  });

  it("moves ad_account_created → funded (card_attached) when Meta reports the card, with the child's own token", async () => {
    const { deps, calls, writes } = fake({ funding: CARD, members: [{ id: "8801" }], assigned: [{ id: "8801", tasks: ["MANAGE"] }] });
    expect(await checkFunding(deps)).toEqual({ status: "funded" });
    expect(calls).toContain("GET act_7301?fields=account_status,funding_source_details child-token");
    expect(writes).toEqual([
      ["update", { state: "funded", funding_state: "card_attached", last_error: null }, "ad_account_created"],
      ["event", { step: "funding", outcome: "succeeded", idempotency_key: "funding:b", meta_object_id: "act_7301" }],
    ]);
  });

  it("then moves on to whatsapp_linked when the Page's number was recorded while it waited for the card", async () => {
    const { deps, writes } = fake({ funding: CARD, row: { ...ROW, whatsapp_number_e164: "+919999990874" } });
    await checkFunding(deps);
    expect(writes).toContainEqual(["update", { state: "whatsapp_linked" }, "funded"]);
  });

  it("writes nothing while there's no card, and says whether the person has joined", async () => {
    for (const funding of [NO_CARD, FS_NULL, PREPAID, GRACE]) {
      const { deps, writes } = fake({ funding });
      const result = await checkFunding(deps);
      expect(result.status).toBe("not_funded");
      expect(writes).toEqual([]);
    }
    expect(await checkFunding(fake().deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "none" });
  });

  it("reads an unaccepted invite as 'waiting for your person', never an error", async () => {
    expect(await checkFunding(fake({ pending: [{ id: "9901" }] }).deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "invited" });
    const invited = fake({ row: { ...ROW, step_keys: { ...ROW.step_keys as object, payer_invite: "invite:b" } } });
    expect(await checkFunding(invited.deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "invited" });
  });

  it("gives a person who has joined the child MANAGE on its ad account (it includes billing), once", async () => {
    const joined = fake({ members: [{ id: "8801" }], assigned: [{ id: "5501", tasks: ["MANAGE", "ADVERTISE", "ANALYZE"] }] });
    expect(await checkFunding(joined.deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "joined" });
    expect(joined.calls).toContain(`POST act_7301/assigned_users {"user":"8801","tasks":"[\\"MANAGE\\"]","business":"7201"} child-token`);
    const granted = fake({ members: [{ id: "8801" }], assigned: [{ id: "8801", tasks: ["MANAGE"] }] });
    await checkFunding(granted.deps);
    expect(granted.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("calls Meta only once the child, its ad account and the manager's grant exist", async () => {
    for (const row of [null, { ...ROW, state: "child_created", ad_account_id: null }, { ...ROW, step_keys: {} }, { ...ROW, manager_token_id: "gone" }]) {
      const { deps, calls } = fake({ row });
      expect(await checkFunding(deps)).toEqual({ status: "waiting_setup" });
      expect(calls).toEqual([]);
    }
    expect(await checkFunding(fake({ row: { ...ROW, state: "failed" } }).deps)).toEqual({ status: "unavailable" });
    expect(await checkFunding(fake({ row: { ...ROW, state: "whatsapp_linked" } }).deps)).toEqual({ status: "funded" });
  });
});

describe("inviting the owner's person to add the card (#2359, a Meta write on our BP)", () => {
  it("validates the email before any Meta call", async () => {
    for (const email of ["", "not-an-email", "a@b", " @x.in"]) {
      const { deps, calls, writes } = fake();
      expect(await invitePayer({ email }, deps)).toEqual({ status: "invalid_email" });
      expect(calls).toEqual([]);
      expect(writes).toEqual([]);
    }
  });

  it("invites them to the child as EMPLOYEE with the child's token, and keeps no email in the ledger", async () => {
    const { deps, calls, writes } = fake();
    expect(await invitePayer({ email: " Owner@Example.in " }, deps)).toEqual({ status: "invited" });
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([`POST 7201/business_users {"email":"owner@example.in","role":"EMPLOYEE"} child-token`]);
    expect(writes).toEqual([
      ["event", { step: "funding", outcome: "started", idempotency_key: "invite:b" }],
      ["update", { step_keys: { grant: "grant:b", page_grant: "page:b", payer_invite: "invite:b" } }, "ad_account_created"],
    ]);
    expect(JSON.stringify(writes)).not.toContain("example.in");
  });

  it("reads before it writes: an existing member or pending invite isn't invited twice", async () => {
    for (const options of [{ members: [{ id: "8801", email: "owner@example.in" }] }, { pending: [{ id: "9901", email: "OWNER@example.in" }] }]) {
      const { deps, calls } = fake(options);
      expect(await invitePayer({ email: "owner@example.in" }, deps)).toEqual({ status: "invited" });
      expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    }
  });

  it("refuses a new address while 3 invites are unaccepted, so the child can't send spam; a repeat address is still fine", async () => {
    const pending = [1, 2, 3].map((n) => ({ id: `990${n}`, email: `person${n}@example.in` }));
    const full = fake({ pending });
    expect(await invitePayer({ email: "owner@example.in" }, full.deps)).toEqual({ status: "too_many_invites" });
    expect(full.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(full.writes).toEqual([]);
    expect(await invitePayer({ email: "person2@example.in" }, fake({ pending }).deps)).toEqual({ status: "invited" });
  });

  it("doesn't invite before the ad account is set up, after it stopped, or once it's funded", async () => {
    expect(await invitePayer({ email: "owner@example.in" }, fake({ row: null }).deps)).toEqual({ status: "waiting_setup" });
    expect(await invitePayer({ email: "owner@example.in" }, fake({ row: { ...ROW, state: "offboarding" } }).deps)).toEqual({ status: "unavailable" });
    expect(await invitePayer({ email: "owner@example.in" }, fake({ row: { ...ROW, state: "funded" } }).deps)).toEqual({ status: "funded" });
  });

  it("lets a Meta failure reach the route as an error (mapped to an owner code there), after recording the attempt", async () => {
    const { deps, writes } = fake();
    deps.graph.post = async () => { throw Object.assign(new Error("Meta request failed."), { status: 400, code: 200 }); };
    await expect(invitePayer({ email: "owner@example.in" }, deps)).rejects.toMatchObject({ code: 200 });
    expect(writes).toEqual([["event", { step: "funding", outcome: "started", idempotency_key: "invite:b" }]]);
  });
});
