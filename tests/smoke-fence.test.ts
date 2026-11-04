import { describe, expect, it, vi } from "vitest";
import { fenceHeaderValue, fenceStop, policyParity, SMOKE_FENCE_HEADER as scriptHeader } from "../scripts/lib/smoke-fence.mjs";
import { alignPrintedNumbers } from "@/lib/creative/chat-number";
import { readFileSync } from "node:fs";
import internal from "@/lib/internal-accounts.json";
import { freeOnlyEligibility } from "@/lib/internal-accounts";
import { assertFenceOwnsDraft, FENCE_CAPABILITY_TTL_MS, refuseWhenFenced, SMOKE_FENCE_HEADER, SmokeFenceError, smokeFenceResponse } from "@/lib/security/smoke-fence";
import { issueDraftCapability, requestIsFenced, smokeFence } from "@/lib/security/smoke-fence-server";

const headerStore = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({ headers: async () => { if (!headerStore.headers) throw new Error("outside a request"); return headerStore.headers; } }));
const SECRET = "s".repeat(40);
vi.mock("@/lib/env", () => ({ getEnv: () => ({ TEST_SESSION_SECRET: SECRET }) }));
const req = (value?: string) => new Request("http://localhost/api/x", { headers: value === undefined ? {} : { [SMOKE_FENCE_HEADER]: value } });
const USER = "u-1";
const created = new Date().toISOString();
const issued = (draft: string, user = USER, at = created) => {
  const token = issueDraftCapability(req("draft-only"), user, draft, at)!;
  return [draft, token] as const;
};
const signed = (...ids: string[]) => fenceHeaderValue(new Map(ids.map((draft) => issued(draft))));
const id = "d123d123-d123-4123-8123-d123d123d123";
const other = "e123e123-e123-4123-8123-e123e123e123";

describe("draft-only smoke fence (#2861)", () => {
  it("is off without the header, and owns drafts only through capabilities issued to this user", () => {
    expect(smokeFence(req())).toBeNull();
    expect([...smokeFence(req("draft-only"), USER)!.ownedDraftIds]).toEqual([]);
    expect([...smokeFence(req(signed(id, other)), USER)!.ownedDraftIds]).toEqual([id, other]);
  });

  it("issues a capability only to a fenced request", () => {
    expect(issueDraftCapability(req(), USER, id, created)).toBeNull();
    expect(issueDraftCapability(req("draft-only"), USER, id, "not a date")).toBeNull();
  });

  it("fences, owning nothing, on any malformed value (fail closed)", () => {
    for (const value of ["", "on", "draft-only; drafts=*", `draft-only; drafts=${id};x`, `Draft-Only; drafts=${id}`, `draft-only; drafts=${id}`, "draft-only; drafts=" + "a".repeat(36) + ",".repeat(3)]) {
      const fence = smokeFence(req(value), USER);
      expect(fence, value).not.toBeNull();
      expect(fence!.ownedDraftIds.size, value).toBe(0);
    }
  });

  it("owns nothing for a forged, another user's, another draft's or an expired capability", () => {
    const [, token] = issued(id);
    const [, theirs] = issued(id, "u-2");
    const [draftId, exp, sig] = token.split(".");
    const expired = issued(id, USER, new Date(Date.now() - FENCE_CAPABILITY_TTL_MS - 1000).toISOString())[1];
    const forged = [`${draftId}.${exp}.${"0".repeat(64)}`, theirs, `${other}.${exp}.${sig}`, `${draftId}.${Number(exp) + 1}.${sig}`, expired];
    for (const value of forged) expect(smokeFence(req(`draft-only; drafts=${value}`), USER)!.ownedDraftIds.size, value).toBe(0);
    expect(smokeFence(req(signed(id)))!.ownedDraftIds.size).toBe(0);
  });

  it("refuses a signed pre-existing draft: the capability must match the row's creation time", () => {
    const fence = smokeFence(req(signed(id)), USER);
    expect(() => assertFenceOwnsDraft(fence, id, created)).not.toThrow();
    expect(() => assertFenceOwnsDraft(fence, id, new Date(Date.parse(created) - 3_600_000).toISOString())).toThrow(SmokeFenceError);
  });

  it("lets only drafts the run created through, and nothing is checked without a fence", () => {
    const fence = smokeFence(req(signed(id)), USER);
    expect(() => assertFenceOwnsDraft(fence, id)).not.toThrow();
    expect(() => assertFenceOwnsDraft(fence, other)).toThrow(SmokeFenceError);
    expect(() => assertFenceOwnsDraft(null, other)).not.toThrow();
  });

  it("answers with a 409 that names the effect", async () => {
    const response = smokeFenceResponse("r1", new SmokeFenceError("whatsapp_binding"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "SMOKE_FENCE", effect: "whatsapp_binding", retryable: false });
  });

  it("shares one header contract with the smoke script, which reports a refusal as not a pass", async () => {
    expect(scriptHeader).toBe(SMOKE_FENCE_HEADER);
    expect(smokeFence(req(signed()), USER)?.ownedDraftIds.size).toBe(0);
    expect([...smokeFence(req(signed(id)), USER)!.ownedDraftIds]).toEqual([id]);
    const body = await smokeFenceResponse("r1", new SmokeFenceError("picture_redraw")).json();
    expect(fenceStop(body)).toMatch(/BLOCKED by the draft-only fence \(picture_redraw\).*not a pass/);
    expect(fenceStop({ ok: true })).toBeNull();
    expect(fenceStop({ error: { code: "CONFLICT" } })).toBeNull();
  });

  it("stops a review on a redraw instead of reading it as a picture that couldn't be redrawn", async () => {
    const creatives = [{ id: "c1", imageUrl: "u", printedPhone: "+919999990000" }];
    const fenceStopRedraw = async () => { throw new SmokeFenceError("picture_redraw"); };
    await expect(alignPrintedNumbers(creatives, "+919999991111", fenceStopRedraw)).rejects.toBeInstanceOf(SmokeFenceError);
    const failing = async () => { throw new Error("storage down"); };
    expect((await alignPrintedNumbers(creatives, "+919999991111", failing)).notice).toMatch(/./);
    await expect(alignPrintedNumbers(creatives, "+919999990000", fenceStopRedraw)).resolves.toMatchObject({ notice: null });
  });

  it("marks any fenced request, in a route or a server component, and nothing outside a request", async () => {
    headerStore.headers = new Headers({ [SMOKE_FENCE_HEADER]: "draft-only" });
    expect(await requestIsFenced()).toBe(true);
    headerStore.headers = new Headers();
    expect(await requestIsFenced()).toBe(false);
    headerStore.headers = null;
    expect(await requestIsFenced()).toBe(false);
  });

  it("refuses every fenced request on the AI-provider routes before any limit or usage, and leaves others alone", async () => {
    const refused = refuseWhenFenced(req("draft-only"))!;
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatchObject({ code: "SMOKE_FENCE", effect: "ai_provider" });
    expect(refuseWhenFenced(req())).toBeNull();
    for (const route of ["creatives/generate", "creatives/assistant", "creatives/[id]/regenerate", "creatives/[id]/picture", "creatives/[id]/background", "brand/autofill"]) {
      const source = readFileSync(`src/app/api/${route}/route.ts`, "utf8");
      const handler = source.slice(source.indexOf("async function handlePOST"));
      expect(handler.slice(0, 400), route).toContain("refuseWhenFenced(");
    }
  });

  it("holds the WS1 walk to a free-only identity before any page or AI call (#2861 path B)", () => {
    expect(freeOnlyEligibility({ id: "00000000-0000-4000-8000-000000000000", email: "x@example.com", email_confirmed_at: "2026-01-01" })).toEqual({ text: false, images: false });
    expect(freeOnlyEligibility(null)).toEqual({ text: false, images: false });
    const smokeId = internal.smokeUserIds[0];
    expect(freeOnlyEligibility({ id: smokeId }).text).toBe(true);
    const exempt = internal.exemptFromFreeProviders[0].userId;
    expect(freeOnlyEligibility({ id: exempt }).images).toBe(false);
    const walk = readFileSync("scripts/ws1-walk.mts", "utf8");
    const gate = walk.indexOf("freeOnlyEligibility(user)");
    expect(gate).toBeGreaterThan(walk.indexOf("await signInBrowser("));
    expect(gate).toBeLessThan(walk.indexOf("page.goto("));
    expect(walk).toContain("Coverage NOT run");
  });
});

describe("#2861 path B parity", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  it("passes only when the served release is the checked-out commit", () => {
    expect(policyParity(a, a).ok).toBe(true);
  });
  it("fails closed on a different, missing or malformed release or an unknown checkout", () => {
    expect(policyParity(b, a).ok).toBe(false);
    expect(policyParity("", a).reason).toMatch(/no X-AdBrain-Release/);
    expect(policyParity("local", a).ok).toBe(false);
    expect(policyParity(a, "").ok).toBe(false);
  });
});
