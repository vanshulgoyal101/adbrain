import { describe, expect, it } from "vitest";
import { scan } from "../scripts/scan-public-data.mjs";

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
});
