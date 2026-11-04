import { describe, expect, it } from "vitest";
import { fenceHeaderValue, fenceStop, SMOKE_FENCE_HEADER as scriptHeader } from "../scripts/lib/smoke-fence.mjs";
import { alignPrintedNumbers } from "@/lib/creative/chat-number";
import { assertFenceOwnsDraft, SMOKE_FENCE_HEADER, smokeFence, SmokeFenceError, smokeFenceResponse } from "@/lib/security/smoke-fence";

const id = "d123d123-d123-4123-8123-d123d123d123";
const other = "e123e123-e123-4123-8123-e123e123e123";
const req = (value?: string) => new Request("http://localhost/api/x", { headers: value === undefined ? {} : { [SMOKE_FENCE_HEADER]: value } });

describe("draft-only smoke fence (#2861)", () => {
  it("is off without the header, and on with owned drafts when the smoke sends them", () => {
    expect(smokeFence(req())).toBeNull();
    expect([...smokeFence(req("draft-only"))!.ownedDraftIds]).toEqual([]);
    expect([...smokeFence(req(`draft-only; drafts=${id},${other}`))!.ownedDraftIds]).toEqual([id, other]);
  });

  it("fences, owning nothing, on any malformed value (fail closed)", () => {
    for (const value of ["", "on", "draft-only; drafts=*", `draft-only; drafts=${id};x`, `Draft-Only; drafts=${id}`, "draft-only; drafts=" + "a".repeat(36) + ",".repeat(3)]) {
      const fence = smokeFence(req(value));
      expect(fence, value).not.toBeNull();
      expect(fence!.ownedDraftIds.size, value).toBe(0);
    }
  });

  it("lets only drafts the run created through, and nothing is checked without a fence", () => {
    const fence = smokeFence(req(`draft-only; drafts=${id}`));
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
    expect(smokeFence(req(fenceHeaderValue(new Set())))?.ownedDraftIds.size).toBe(0);
    expect([...smokeFence(req(fenceHeaderValue(new Set([id]))))!.ownedDraftIds]).toEqual([id]);
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
});
