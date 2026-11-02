import { describe, expect, it } from "vitest";
import { githubCommentIds, idCandidates, scan } from "../scripts/scan-public-data.mjs";

describe("public-data scanner (#1627)", () => {
  it("flags customer data by type only", () => {
    expect(scan("Owner's number is +91 98123 45678, call after 6")).toEqual(["indian_mobile"]);
    expect(scan("reach 9812345678 or 09812345678")).toEqual(["indian_mobile"]);
    expect(scan("contact neha.salon@gmail.com")).toEqual(["email"]);
    expect(scan("ad account act_1029384756 failed")).toEqual(["meta_ad_account"]);
    expect(scan("page 102938475610293 rejected")).toEqual(["meta_id"]);
    expect(scan(`token EAA${"b".repeat(40)}`)).toEqual(["token"]);
    expect(scan(`key sk-or-v1-${"a1".repeat(20)}`)).toEqual(["token"]);
    expect(scan("rzp_live_AbCdEfGhIjKl leaked")).toEqual(["token"]);
    expect(scan(`ghp_${"x".repeat(36)}`)).toEqual(["token"]);
    expect(scan("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toEqual(["jwt"]);
    expect(scan("captured pay_Nx9AbCdEfGhIjK")).toEqual(["payment_id"]);
    expect(scan("+91 98123 45678 and owner@shop.in")).toEqual(["email", "indian_mobile"]);
    expect(scan("page and 917001234599 on WhatsApp")).toEqual(["indian_mobile"]);
  });

  it("ignores the team's own ids, fake ids and GitHub numbers", () => {
    expect(scan("see https://github.com/vanshulgoyal101/adbrain/issues/1546#issuecomment-6476064479")).toEqual([]);
    expect(scan("run https://github.com/vanshulgoyal101/adbrain/actions/runs/40756575003")).toEqual([]);
    expect(scan("fake account act_900000001546, campaign 900000000015460, act_123")).toEqual([]);
    expect(scan("qa2+prospect-bio3@adbrain.vanshul.com and adbrain-handover-1698@example.com")).toEqual([]);
    expect(scan("123456789012345 and 0000000000000000")).toEqual([]);
    expect(scan("sha 9a8b7c6d5e98765432101f2e3d4c5b6a7f8e9d0c and 2026-10-28T20:08Z")).toEqual([]);
    expect(scan("41 Dev 4 counted 3 of 14 businesses; ₹999 a month; 63306 rows")).toEqual([]);
    expect(scan("a JWT starts with eyJ, and EAA is Meta's prefix")).toEqual([]);
    expect(scan("Dev 3's runbook (comment 6464957507) and run 40756575003")).toEqual([]);
    // #2151: GitHub comment ids (~6.4e9) look like mobiles; a list after "comments" is still ids.
    expect(scan("delete the earlier revisions of comments 6396936263, 6444232534 and 6446256329.")).toEqual([]);
    expect(scan("comments #6396936263 or 6444232534; call 9812345678")).toEqual(["indian_mobile"]);
    expect(scan("placeholder `9876543210` and +91 98765 43210")).toEqual([]);
    expect(scan('no false redraws for "98765 44842" or "098765 44842" against +91 98765 44842')).toEqual([]);
    expect(scan("Solaride act_2398686420592052, Page 885223068001054, app 2286157145462990")).toEqual([]);
    expect(scan("")).toEqual([]);
  });

  // #2727: comment ids passed 6e9, so bare ids cited in prose look like mobiles.
  it("ignores bare GitHub comment ids only when GitHub knows them", () => {
    const link = "[6581991068](https://github.com/vanshulgoyal101/adbrain/issues/2595#issuecomment-6581991068)";
    expect(scan(`use the completed spec ${link}`)).toEqual([]);
    expect(scan("[9812345678](https://wa.me/919812345678)")).toEqual(["indian_mobile"]);
    expect(scan("[9812345678](https://github.com/o/r/issues/1#issuecomment-6581991068)")).toEqual(["indian_mobile"]);
    const ids = new Set(["6577045396", "6577479113"]);
    expect(scan("(CPO flow 6577045396, Analyst fields 6577479113).", ids)).toEqual([]);
    expect(scan("CPO flow 6577045396")).toEqual(["indian_mobile"]);
    expect(scan("CPO flow 6577045396; call 9812345678", ids)).toEqual(["indian_mobile"]);
    expect(scan("call +91 65770 45396 or 065770-45396", ids)).toEqual(["indian_mobile"]);
  });

  it("lists only bare 10-digit numbers outside links as id candidates", () => {
    const text = "flow 6577045396, again 6577045396, phone +91 98123 45678, 9812345678 "
      + "and https://github.com/o/r/issues/1#issuecomment-6581991068 or 41469095565";
    expect(idCandidates(text)).toEqual(["6577045396", "9812345678"]);
  });

  it("asks GitHub about unknown candidates only, within a bound", async () => {
    const asked: string[] = [];
    const exists = async (id: string) => { asked.push(id); return id.startsWith("65"); };
    const ids = await githubCommentIds(["6500000001", "9812345678", "6500000002"], new Set(["6500000002"]), exists);
    expect([...ids].sort()).toEqual(["6500000001", "6500000002"]);
    expect(asked).toEqual(["6500000001", "9812345678"]);
    const many = Array.from({ length: 120 }, (_, i) => String(6500000000 + i));
    asked.length = 0;
    expect((await githubCommentIds(many, new Set(), exists)).size).toBe(100);
    expect(asked).toHaveLength(100);
    expect([...(await githubCommentIds(["6500000001"], new Set(), async () => { throw new Error("rate limited"); }))]).toEqual([]);
  });
});
