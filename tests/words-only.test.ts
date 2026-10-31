import ts from "typescript";
import { describe, expect, it } from "vitest";
import { prose, readsWords, wordRuns, wordsLine, wordsOnly } from "../scripts/words-only.mjs";

const f = "src/lib/campaign/x.ts";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const none = (_run: string) => false;
const words = (base: string, head: string, file = f, elsewhere = none) => wordsOnly(ts, file, base, head, elsewhere);
const msg = (text: string) => `export function m(ok: boolean) {\n  if (!ok) return { error: "${text}", retryable: true };\n  return null;\n}\n`;

describe("words-only (#364)", () => {
  it("passes reworded messages, Hindi, templates, JSX, errors, toasts and comments", () => {
    expect(words(msg("Meta didn't change the ad. Nothing changed."), msg("Meta may have paused it. Refresh before trying again."))).toBe(true);
    expect(words(msg("कुछ नहीं बदला"), msg("विज्ञापन रुका है"))).toBe(true);
    expect(words("toast(`Budget ${a} a day for ${d} days`);\n", "toast(`Spend ${a} each day, for ${d} days`);\n")).toBe(true);
    expect(words("export const P = () => <p>Your ad is live now</p>;\n", "export const P = () => <p>Your ad is running on Facebook</p>;\n", "src/lib/campaign/p.tsx")).toBe(true);
    expect(words("export const P = () => <i title=\"Pause this ad\" />;\n", "export const P = () => <i title=\"Stop this ad for now\" />;\n", "src/lib/campaign/p.tsx")).toBe(true);
    expect(words("throw new MetaError(\"Meta could not save the ad\");\n", "throw new MetaError(\"Facebook didn't save your ad\");\n")).toBe(true);
    expect(words("const r = { message: ok ? \"Your ad is live\" : \"Your ad is paused\" };\n", "const r = { message: ok ? \"Your ad is running\" : \"Your ad is paused\" };\n")).toBe(true);
    expect(words("const a = 1; // old note\n", "const a = 1; // new note\n")).toBe(true);
  });

  it("keeps the gate on round 1 of the attack", () => {
    const g = (base: string, head: string) => expect(words(base, head)).toBe(false);
    g("async function l() {\n  await assertSpendLimit(1, 2);\n  await launch();\n}\n", "async function l() {\n  /*\n  await assertSpendLimit(1, 2);\n  */\n  await launch();\n}\n");
    g("async function l() {\n  await launch();\n}\n", "async function l() {\n  /* audit */ await meta.post({ status: \"ACTIVE\" });\n  await launch();\n}\n");
    g("async function l(ok: boolean) {\n  if (!ok) return;\n  await launch();\n}\n", "async function l(ok: boolean) {\n  await launch();\n  if (!ok) return;\n}\n");
    g("const on = \"ACTIVE\";\nconst off = \"PAUSED\";\n", "const on = \"PAUSED\";\nconst off = \"ACTIVE\";\n");
    g("q.select(\"id, status\");\n", "q.select(\"id, status, access_token, business_id\");\n");
    g("q.or(\"status.eq.ACTIVE, status.eq.PAUSED\");\n", "q.or(\"status.eq.ACTIVE, business_id.neq.0\");\n");
    g("const o = { fields: \"id, name, status\" };\n", "const o = { fields: \"id, name, status, daily_budget\" };\n");
    g("if (msg.includes(\"Invalid OAuth access token\")) x();\n", "if (msg.includes(\"Session has expired now\")) x();\n");
    g("if (msg === \"Invalid OAuth access token\") x();\n", "if (msg === \"Session has expired now\") x();\n");
    g("switch (m) { case \"rate limit hit\": x(); }\n", "switch (m) { case \"rate limit reached\": x(); }\n");
    g("const k = { \"Invalid OAuth token\": 1 };\n", "const k = { \"Expired OAuth token\": 1 };\n");
    g("const w = (s: string, b: string) => `status = ${s} and business_id = ${b}`;\n", "const w = (s: string, b: string) => `status = ${s} or business_id = ${b}`;\n");
    g("const c = JSON.parse('{\"cap\": 500}');\n", "const c = JSON.parse('{\"cap\": 500000}');\n");
    g("const p = rupees\n  * 100;\n", "const p = rupees\n  * 1000;\n");
    g("toast(`Budget ${a} a day`);\n", "toast(`Budget ${a * 2} a day`);\n");
    g("const r = { retryable: true };\n", "const r = { retryable: false };\n");
    g("const u = \"https://graph.facebook.com/me\";\n", "const u = \"https://graph.facebook.com/act\";\n");
    g(msg("Nothing changed."), msg("Nothing changed.").replace("return null;", "return { error: \"Nothing changed now\" };"));
    g("const a = (;\n", "const a = (;;\n");
    expect(wordsOnly(ts, f, null, msg("New file here"), none)).toBe(false);
    expect(wordsOnly(ts, "src/lib/internal-accounts.json", "{}", "{ }", none)).toBe(false);
    expect(wordsOnly(null as never, f, msg("a b"), msg("c d"), none)).toBe(false);
  });

  it("keeps the gate on round 2 of the attack", () => {
    const g = (base: string, head: string, elsewhere: (run: string) => boolean = none) => expect(words(base, head, f, elsewhere)).toBe(false);
    g("const AUTH = \"Invalid OAuth access token\";\nif (msg.includes(AUTH)) refresh();\n", "const AUTH = \"never matches this\";\nif (msg.includes(AUTH)) refresh();\n");
    g("if ([\"Invalid OAuth access token\", \"Session has expired\"].includes(m)) refresh();\n", "if ([\"Bad token now\", \"Session has expired\"].includes(m)) refresh();\n");
    g("if (msg.includes(\"Invalid OAuth\" + \" access token\")) r();\n", "if (msg.includes(\"Bad OAuth\" + \" access token\")) r();\n");
    g("if (msg.includes(x ? \"Invalid OAuth token\" : \"Session has expired\")) r();\n", "if (msg.includes(x ? \"Bad OAuth token\" : \"Session has expired\")) r();\n");
    g("if (isMetaError(e, \"Invalid OAuth access token\")) r();\n", "if (isMetaError(e, \"Bad OAuth access token\")) r();\n");
    // A message another file matches on (`e.message.includes("token expired now")`).
    g("throw new Error(\"Meta token expired now\");\n", "throw new Error(\"Meta login lapsed today\");\n", (run) => run === "Meta token expired" || run === "token expired now");
    g("function f(b: number) {\n  return budget * 100;\n}\n", "function f(b: number) {\n  return\n  budget * 100;\n}\n");
    g("const q = { sql: \"delete from ads where paused\" };\n", "const q = { sql: \"delete from ads where true\" };\n");
    g("const t = { interests: [{ name: \"Real estate\" }] };\n", "const t = { interests: [{ name: \"Luxury goods\" }] };\n");
    g("registerHandler(meta);\n", "/* @__PURE__ */ registerHandler(meta);\n");
    g("const s = \"चालू\";\n", "const s = \"बंद\";\n");
    g("const n = parseInt(\"500 rupees per day\");\n", "const n = parseInt(\"50000 rupees per day\");\n");
    g("function st() { return \"Ad is live\"; }\n", "function st() { return \"Ad is running\"; }\n");
    g("export default \"Pause all ads\";\n", "export default \"Stop all ads\";\n");
    g("const m = Object.fromEntries([[\"Invalid token now\", refresh]]);\n", "const m = Object.fromEntries([[\"Bad token now\", refresh]]);\n");
    // Fail closed when the cross-file search can't run.
    expect(wordsOnly(ts, f, msg("Meta didn't change the ad"), msg("Meta may have paused it"))).toBe(false);
  });

  it("keeps the gate on round 3 of the attack", () => {
    const g = (base: string, head: string, elsewhere: (run: string) => boolean = none, file = f) => expect(words(base, head, file, elsewhere)).toBe(false);
    // Matchers shorter than three words, here or elsewhere (any case), and wrapped matcher arrays elsewhere.
    g("if (m.includes(\"token expired\")) r();\nthrow new Error(\"Your Meta token expired now\");\n", "if (m.includes(\"token expired\")) r();\nthrow new Error(\"Your Meta login lapsed now\");\n");
    g("if (/token expired/i.test(m)) r();\nthrow new Error(\"Your Meta token expired now\");\n", "if (/token expired/i.test(m)) r();\nthrow new Error(\"Your Meta login lapsed now\");\n");
    // A dictionary entry read as code.
    g("const M = { en: \"Launch it now\" };\nif (label === M.en) go();\n", "const M = { en: \"Start it now\" };\nif (label === M.en) go();\n");
    // Words that are data: a select option, a Meta write, a database row.
    g("export const O = () => <option>Lead form ads</option>;\n", "export const O = () => <option>Chat ads now</option>;\n", none, "src/lib/campaign/o.tsx");
    g("await graph(\"act/adcreatives\", { message: \"Call us today for solar\" });\n", "await graph(\"act/adcreatives\", { message: \"Guaranteed savings on solar\" });\n");
    g("await db.from(\"x\").update({ error: \"Meta rejected the ad\" });\n", "await db.from(\"x\").update({ error: \"Meta paused the ad\" });\n");
    // A moved directive.
    g("/* @__PURE__ */ a();\nb();\n", "a();\n/* @__PURE__ */ b();\n");
  });

  it("a line elsewhere gates only when it reads these words (#364 tuning)", () => {
    const words = "Reconnect Meta and tick your ad account, or sign in with the profile that runs your ads.";
    // Unrelated text sharing a phrase: a login locator, a JSX ternary, a message constant.
    expect(readsWords("await page.getByRole(\"button\", { name: \"Sign in with password\" }).click();", "sign in with", words)).toBe(false);
    expect(readsWords("{pending === \"password\" ? \"Signing in...\" : \"Sign in with password\"}", "sign in with", words)).toBe(false);
    // A matcher or locator of these words, a constant holding them, or the run outside any string.
    expect(readsWords("if (m.includes(\"or sign in with the profile\")) r();", "sign in with", words)).toBe(true);
    expect(readsWords("await page.getByText(\"Reconnect Meta and tick your ad account, or sign in with the profile that runs your ads.\");", "sign in with", words)).toBe(true);
    expect(readsWords("export const X = \"Reconnect Meta and tick your ad account, or sign in with the profile that runs your ads. More.\";", "sign in with", words)).toBe(true);
    expect(readsWords("if (/sign in with the profile/i.test(m)) r();", "sign in with", words)).toBe(true);
    const base = msg(words);
    const head = msg("Reconnect Meta and tick your ad account, or use the profile that runs your ads.");
    const lines = (hit: string) => (run: string) => (run === "sign in with" ? [hit] : []);
    expect(wordsOnly(ts, f, base, head, lines("await page.getByRole(\"button\", { name: \"Sign in with password\" }).click();"))).toBe(true);
    expect(wordsOnly(ts, f, base, head, lines("if (m.includes(\"or sign in with the profile\")) r();"))).toBe(false);
    expect(wordsOnly(ts, f, base, head, () => true)).toBe(false);
  });

  it("prose means words for a person, not code with spaces", () => {
    expect(prose("Refresh the campaign before trying again.")).toBe(true);
    expect(prose("₹300 a day for 2 days")).toBe(true);
    expect(prose("Add a phone, e.g. 98100 00000")).toBe(true);
    expect(prose("Tap \"Launch\" to go")).toBe(true);
    for (const code of ["PAUSED", "विज्ञापन", "id, name, status", "status.eq.ACTIVE, x", "{cap: 1} now", "/api/campaigns now", "https://x.y z"]) {
      expect(prose(code)).toBe(false);
    }
    expect(wordRuns("Meta token expired now")).toEqual(["Meta token expired", "token expired now"]);
    for (const line of ["if (e.message.includes(\"token expired now\"))", "const AUTH = \"Meta token expired now\";", "case \"token expired now\":",
      "  \"Meta token expired now\",", "  auth: \"Meta token expired now\",", "await page.getByRole(\"button\", { name: \"token expired now\" }).click();", "if (/token expired now/i.test(m))", "  message: m.includes(\"token expired now\") ? a : b,", "if ([\"token expired now\"].includes(m)) throw new Error(\"x y\");"]) {
      expect(wordsLine(line, "token expired now")).toBe(false);
    }
    for (const line of ["  message: \"Your token expired now, reconnect.\",", "<p>Your token expired now.</p>", "// token expired now", "            or your token expired now",
      "      It&apos;s yours. Your token expired now.", "throw new MetaError(\"token expired now\");", "return apiError(\"Your token expired now.\", 403);", "  description=\"Your token expired now\"", "if (typeof id !== \"string\") throw new CampaignError(\"Meta token expired now\");", "throw new CampaignDeliveryError(s === \"PAUSED\" ? \"Meta token expired now.\" : \"Other words here\");"]) {
      expect(wordsLine(line, "token expired now")).toBe(true);
    }
  });
});
