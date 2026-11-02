import { describe, expect, it } from "vitest";
import { checkFunding, fundingFromMeta, invitePayer, payerKey, type BillingDeps, type BillingRow } from "@/lib/meta/managed-billing";

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

const PAYER = "k:owner@example.in";
const NAMED = { ...ROW, step_keys: { ...(ROW.step_keys as object), payer: PAYER } };

type Fake = {
  row?: BillingRow | null; members?: unknown; pending?: unknown; assigned?: { id: string; tasks?: string[] }[]; funding?: unknown;
  /** What the conditional ledger write matched; false when the state moved after the read. */
  matched?: boolean; rowAfterMiss?: BillingRow | null; lease?: { held: boolean }; delayMs?: number;
};

function fake(options: Fake = {}) {
  const calls: string[] = [];
  const writes: unknown[] = [];
  let row = options.row === undefined ? ROW : options.row;
  const lease = options.lease ?? { held: false };
  const list = (value: unknown, fallback: unknown[] = []) => (value === undefined ? { data: fallback } : Array.isArray(value) ? { data: value } : value);
  const pause = () => new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const deps: BillingDeps = {
    businessId: "b",
    row: async () => row,
    managerToken: async (id) => (id === "tok-1" ? "child-token" : null),
    claim: async () => { if (lease.held) return false; lease.held = true; return true; },
    release: async () => { lease.held = false; return true; },
    update: async (values, whenState) => {
      if (options.matched === false) { row = options.rowAfterMiss ?? null; return false; }
      writes.push(["update", values, whenState]);
      return true;
    },
    event: async (values) => { writes.push(["event", values]); },
    payerKey: (address) => `k:${address}`,
    graph: {
      get: async <T,>(path: string, token: string) => {
        calls.push(`GET ${path} ${token}`);
        await pause();
        if (path.startsWith("7201/business_users")) return list(options.members) as T;
        if (path.startsWith("7201/pending_users")) return list(options.pending) as T;
        if (path.startsWith("act_7301/assigned_users")) return list(options.assigned) as T;
        if (path.startsWith("act_7301?")) return (options.funding ?? NO_CARD) as T;
        throw new Error(`unexpected ${path}`);
      },
      post: async <T,>(path: string, form: Record<string, string>, token: string) => {
        calls.push(`POST ${path} ${JSON.stringify(form)} ${token}`);
        await pause();
        return { success: true } as T;
      },
    },
  };
  return { deps, calls, writes, posts: () => calls.filter((call) => call.startsWith("POST")) };
}

const GRANT = (user: string) => `POST act_7301/assigned_users {"user":"${user}","tasks":"[\\"MANAGE\\"]","business":"7201"} child-token`;
const INVITE = (email: string) => `POST 7201/business_users {"email":"${email}","role":"EMPLOYEE"} child-token`;

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
    const { deps, calls, writes } = fake({ row: NAMED, funding: CARD, members: [{ id: "8801", email: "owner@example.in" }], assigned: [{ id: "8801", tasks: ["MANAGE"] }] });
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

  // QA on e15ca699: the row moved to offboarding after the read; the write matched nothing, yet it said funded and logged success.
  it("never reports funded or logs success when the ledger write matched no row; it reports the state now", async () => {
    for (const [rowAfterMiss, status] of [[{ ...ROW, state: "offboarding" }, "unavailable"], [{ ...ROW, state: "funded" }, "funded"], [null, "waiting_setup"]] as const) {
      const { deps, writes } = fake({ funding: CARD, matched: false, rowAfterMiss });
      expect(await checkFunding(deps)).toEqual({ status });
      expect(writes).toEqual([]);
    }
  });

  it("writes nothing while there's no card, and says whether the named person has joined", async () => {
    for (const funding of [NO_CARD, FS_NULL, PREPAID, GRACE]) {
      const { deps, writes } = fake({ funding });
      const result = await checkFunding(deps);
      expect(result.status).toBe("not_funded");
      expect(writes).toEqual([]);
    }
    expect(await checkFunding(fake().deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "none" });
  });

  it("reads an unaccepted invite as 'waiting for them', never an error", async () => {
    expect(await checkFunding(fake({ row: NAMED, pending: [{ id: "9901", email: "owner@example.in" }] }).deps))
      .toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "invited" });
  });

  it("gives the named person MANAGE on the ad account once they've joined (it includes billing), once", async () => {
    const joined = fake({ row: NAMED, members: [{ id: "8801", email: "Owner@Example.in" }], assigned: [{ id: "5501", tasks: ["MANAGE", "ADVERTISE", "ANALYZE"] }] });
    expect(await checkFunding(joined.deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "joined" });
    expect(joined.posts()).toEqual([GRANT("8801")]);
    const granted = fake({ row: NAMED, members: [{ id: "8801", email: "owner@example.in" }], assigned: [{ id: "8801", tasks: ["MANAGE"] }] });
    await checkFunding(granted.deps);
    expect(granted.posts()).toEqual([]);
  });

  // QA on e15ca699: Check with no invite and two existing members granted both.
  it("grants nobody else: not existing members without a named person, and not an unrelated member beside them", async () => {
    const staff = [{ id: "8802", email: "staff@example.in" }, { id: "8803", email: "parent-admin@example.in" }];
    const unnamed = fake({ members: staff });
    expect(await checkFunding(unnamed.deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "none" });
    expect(unnamed.posts()).toEqual([]);
    const beside = fake({ row: NAMED, members: [...staff, { id: "8801", email: "owner@example.in" }] });
    await checkFunding(beside.deps);
    expect(beside.posts()).toEqual([GRANT("8801")]);
    const absent = fake({ row: NAMED, members: staff });
    expect(await checkFunding(absent.deps)).toEqual({ status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "invited" });
    expect(absent.posts()).toEqual([]);
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

  it("names the person (a keyed hash, never the email) before inviting them to the child as EMPLOYEE with the child's token", async () => {
    const { deps, writes, posts } = fake();
    expect(await invitePayer({ email: " Owner@Example.in " }, deps)).toEqual({ status: "invited" });
    expect(posts()).toEqual([INVITE("owner@example.in")]);
    expect(writes).toEqual([
      ["update", { step_keys: { grant: "grant:b", page_grant: "page:b", payer: PAYER } }, "ad_account_created"],
      ["event", { step: "funding", outcome: "started", idempotency_key: "invite:b" }],
    ]);
  });

  it("keeps no email in the ledger: the real key is a 32-character HMAC under the app secret", () => {
    const key = payerKey("owner@example.in", "app-secret");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(payerKey("owner@example.in", "other-secret")).not.toBe(key);
    expect(payerKey("other@example.in", "app-secret")).not.toBe(key);
  });

  // QA on e15ca699: an existing member got "invited" and was told to check email; the grant waited for a Check.
  it("tells the truth about a person already in the child (granted now) or already invited (no new invite)", async () => {
    const member = fake({ members: [{ id: "8801", email: "owner@example.in" }] });
    expect(await invitePayer({ email: "owner@example.in" }, member.deps)).toEqual({ status: "joined" });
    expect(member.posts()).toEqual([GRANT("8801")]);
    const waiting = fake({ pending: [{ id: "9901", email: "OWNER@example.in" }] });
    expect(await invitePayer({ email: "owner@example.in" }, waiting.deps)).toEqual({ status: "pending" });
    expect(waiting.posts()).toEqual([]);
    expect(waiting.writes).toEqual([["update", { step_keys: { grant: "grant:b", page_grant: "page:b", payer: PAYER } }, "ad_account_created"]]);
  });

  it("refuses a new address while 3 invites are unaccepted, so the child can't send spam; a repeat address is still fine", async () => {
    const pending = [1, 2, 3].map((n) => ({ id: `990${n}`, email: `person${n}@example.in` }));
    const full = fake({ pending });
    expect(await invitePayer({ email: "owner@example.in" }, full.deps)).toEqual({ status: "too_many_invites" });
    expect(full.posts()).toEqual([]);
    expect(full.writes).toEqual([]);
    expect(await invitePayer({ email: "person2@example.in" }, fake({ pending }).deps)).toEqual({ status: "pending" });
  });

  // QA on e15ca699: four simultaneous requests all read zero pending and all four POSTed.
  it("serializes invites for a business: four at once make one Meta invite, the rest are busy and write nothing", async () => {
    const lease = { held: false };
    const runs = [0, 1, 2, 3].map(() => fake({ lease, delayMs: 5 }).deps).map((deps, n) => invitePayer({ email: `person${n}@example.in` }, deps));
    const results = await Promise.all(runs);
    expect(results.filter((r) => r.status === "invited")).toHaveLength(1);
    expect(results.filter((r) => r.status === "busy")).toHaveLength(3);
    expect(lease.held).toBe(false);
  });

  it("releases the lease when Meta fails, so the next try can read back a possibly-sent invite", async () => {
    const lease = { held: false };
    const { deps } = fake({ lease });
    deps.graph.post = async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
    await expect(invitePayer({ email: "owner@example.in" }, deps)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(lease.held).toBe(false);
    const retry = fake({ lease, row: NAMED, pending: [{ id: "9901", email: "owner@example.in" }] });
    expect(await invitePayer({ email: "owner@example.in" }, retry.deps)).toEqual({ status: "pending" });
    expect(retry.posts()).toEqual([]);
  });

  // QA on e15ca699: `{}` for the member/pending reads was read as empty and an invite went out.
  it("fails closed on a malformed or partial list from Meta: no invite, no grant, no ledger write", async () => {
    for (const bad of [{}, { data: null }, { data: [{ email: "x@example.in" }] }, { data: [], paging: { next: "https://graph.facebook.com/next" } }]) {
      for (const options of [{ members: bad }, { pending: bad }]) {
        const { deps, writes, posts } = fake(options);
        await expect(invitePayer({ email: "owner@example.in" }, deps)).rejects.toThrow("incomplete list");
        expect(posts()).toEqual([]);
        expect(writes).toEqual([]);
      }
      const check = fake({ row: NAMED, members: bad });
      await expect(checkFunding(check.deps)).rejects.toThrow("incomplete list");
      expect(check.posts()).toEqual([]);
    }
  });

  it("doesn't invite when the ledger write matched no row; it reports the state now", async () => {
    const { deps, posts } = fake({ matched: false, rowAfterMiss: { ...ROW, state: "offboarding" } });
    expect(await invitePayer({ email: "owner@example.in" }, deps)).toEqual({ status: "unavailable" });
    expect(posts()).toEqual([]);
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
    expect(writes.at(-1)).toEqual(["event", { step: "funding", outcome: "started", idempotency_key: "invite:b" }]);
  });
});
