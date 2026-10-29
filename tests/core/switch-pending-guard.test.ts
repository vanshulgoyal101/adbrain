import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// #1518 (#1146 lesson): while a new-audience copy waits to be switched on, the copy has its own ad set and ads, so
// any write to the running ones would be lost or undone by the switch. Every Meta writer that changes a live ad set
// or ad must call refuseWhileSwitchPending before it writes. This test makes that a CI rule instead of a review habit:
// every public MetaClient method is classified, and every call of a live-edit writer in src is checked.

/** Writers that change a live ad set or ad → the test proving its service refuses (409 switch_pending) before Meta. */
const LIVE_EDITS: Record<string, string> = {
  editAdSetTargeting: "tests/core/edit-routes.test.ts", // audience
  editAdSetBudget: "tests/core/edit-budget.test.ts", // budget
  replaceAdCreative: "tests/core/ad-edit-route.test.ts", // ad copy
  setAdStatus: "tests/ad-pause-service.test.ts", // pausing or resuming one ad
  // Turning a campaign on builds a capped copy of the original ad set, which would run beside a waiting copy (CTO).
  enforceCampaignSpendCap: "tests/core/manage-routes.test.ts",
  createCappedAdSet: "tests/core/manage-routes.test.ts",
  activateCappedTree: "tests/core/manage-routes.test.ts",
};

/** Other writers, each with why the guard does not apply. */
const OTHER_WRITERS: Record<string, string> = {
  createLeadCampaign: "launch builds a new campaign; no copy can wait on it yet",
  uploadAdImage: "the ad account's image library, not the live tree",
  uploadAdImageBytes: "the ad account's image library, not the live tree",
  startAdVideo: "the ad account's video library, not the live tree",
  deleteObject: "deletes a draft or a failed launch",
  switchAdSet: "the switch itself",
  deleteAdSetCopy: "cancels or cleans up the waiting copy",
  setAccountSpendCap: "stopping spend must always work (account limit)",
  pauseCampaignTree: "stopping spend must always work",
  // Its turn-on call sits behind the activation guard above; its pause calls (spend enforcement) must never wait.
  updateCampaignStatus: "stopping spend must always work",
};

const READS = new Set([
  "readAdVideo",
  "getPageAccessToken", "getPageInstagramId", "getWhatsAppNumber", "setupReads", "whatsappNumbers", "listLeadForms", "readActiveLeadForm",
  "listLeadFormsPage", "listLeadsForForm", "listLeadsForFormPage", "searchGeoLocations", "serviceAreaExclusionsFor",
  "resolveGeoTargeting", "resolveAudienceInterests", "listCampaigns", "listCampaignsPage", "readBoundCampaign",
  "getCampaignInsights", "getAdResults", "readLifetimeSpendPaise", "readAccountFunding", "readLiveCappedRuns",
  "readCampaignStopped", "readMinCampaignSpendCapPaise", "readCampaignDelivery", "verifyCampaignActivation", "readAdSetBudget", "adSources", "readAdReview",
]);

const CLIENT = "src/lib/meta/client.ts";
const parse = (path: string) =>
  ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function publicClientMethods(): string[] {
  const names: string[] = [];
  walk(parse(CLIENT), (node) => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== "MetaClient") return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
      const hidden = ts.getModifiers(member)?.some((modifier) => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.StaticKeyword].includes(modifier.kind));
      if (!hidden) names.push(member.name.text);
    }
  });
  return [...new Set(names)];
}

type Call = { at: string; writer: string; guarded: boolean };

/** The live-edit writer calls in one file, and whether each one's top-level function called the guard before it. */
function callsIn(file: ts.SourceFile): Call[] {
  const calls: Call[] = [];
  walk(file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const writer = node.expression.name.text;
    if (!Object.hasOwn(LIVE_EDITS, writer)) return;
    let top: ts.Node = node;
    while (top.parent && top.parent !== file) top = top.parent;
    let guarded = false;
    walk(top, (inner) => {
      if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "refuseWhileSwitchPending" && inner.end <= node.getStart()) guarded = true;
    });
    calls.push({ at: `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`, writer, guarded });
  });
  return calls;
}

const liveEditCalls = () => sources("src").filter((path) => path !== CLIENT).flatMap((path) => callsIn(parse(path)));

describe("core: every Meta writer to a live ad set or ad refuses while a new audience waits (#1518)", () => {
  it("classifies every public MetaClient method as a read, a live edit or another writer", () => {
    const unclassified = publicClientMethods().filter((name) => !READS.has(name) && !Object.hasOwn(LIVE_EDITS, name) && !Object.hasOwn(OTHER_WRITERS, name));
    // A new method here: if it writes to a live ad set or ad, add it to LIVE_EDITS and guard its service.
    expect(unclassified).toEqual([]);
  });

  it("calls refuseWhileSwitchPending before every live-edit write", () => {
    const calls = liveEditCalls();
    expect(calls.filter((call) => !call.guarded).map(({ at, writer }) => `${writer} at ${at}`)).toEqual([]);
    // Each listed writer is really used, so the list can't go stale.
    expect([...new Set(calls.map((call) => call.writer))].sort()).toEqual(Object.keys(LIVE_EDITS).sort());
  });

  it("has a refusal case for each live-edit writer's service", () => {
    for (const [writer, test] of Object.entries(LIVE_EDITS)) expect(readFileSync(test, "utf8"), writer).toMatch(/switch_pending|awaiting_switch/);
  });

  it("would catch an unguarded writer (self-check)", () => {
    const file = ts.createSourceFile("x.ts", [
      "export async function f(meta) { await meta.setAdStatus('c', 'a', 'PAUSED'); }",
      "export async function g(meta, db) { await refuseWhileSwitchPending(db, 'c'); await meta.setAdStatus('c', 'a', 'PAUSED'); }",
      "export async function h(meta, db) { await meta.setAdStatus('c', 'a', 'PAUSED'); await refuseWhileSwitchPending(db, 'c'); }",
    ].join("\n"), ts.ScriptTarget.Latest, true);
    expect(callsIn(file).map((call) => call.guarded)).toEqual([false, true, false]);
  });
});
