import { describe, expect, it, vi } from "vitest";
import { createGitHubApi, readyPool, boardRow, systemicFailures, snoozedUntil, latestWord, linkedIssues, lowQueues, matchers, nextItem, freshComments, offTrack, rateBackoffMs, roleCard, unsavedWork, waitingOnMe } from "../scripts/wait-for-work.mjs";

describe("PR reviews count as the latest word (#423)", () => {
  it("picks a review posted after the last comment, and ignores empty approvals", () => {
    const comments = [{ body: "DevOps: → CTO: please review", created_at: "2026-10-24T16:40:00Z", html_url: "c1" }];
    const reviews = [
      { body: "", submitted_at: "2026-10-24T16:50:00Z", html_url: "r0" },
      { body: "CTO review of e22d633: approved. → DevOps: release", submitted_at: "2026-10-24T16:45:00Z", html_url: "r1" },
    ];
    expect(latestWord(comments, reviews)).toEqual({ body: "CTO review of e22d633: approved. → DevOps: release", at: "2026-10-24T16:45:00Z", url: "r1" });
    expect(waitingOnMe(latestWord(comments, reviews)!.body, matchers("cto"))).toBe(false);
    expect(waitingOnMe(latestWord(comments, reviews)!.body, matchers("devops"))).toBe(true);
    expect(latestWord([], [])).toBeNull();
  });

  it("skips the advisory AI review bot, so a push doesn't wake the PR owner (#587)", () => {
    const comments = [
      { body: "DevOps: resolved at 07b2fec. → QA: please post a verdict", created_at: "2026-10-25T17:00:00Z", html_url: "c1" },
      { body: "<!-- ai-review -->\n**AI review (advisory, not a verdict)**", created_at: "2026-10-25T17:05:00Z", html_url: "c2" },
    ];
    expect(latestWord(comments, [])?.url).toBe("c1");
    expect(waitingOnMe(latestWord(comments, [])!.body, matchers("devops"))).toBe(false);
  });

  it("skips the daily core scoreboard, so it doesn't wake every role on #681", () => {
    const comments = [
      { body: "QA: walk done. → Dev: #692", created_at: "2026-10-26T03:00:00Z", html_url: "c1" },
      { body: "<!-- core-scoreboard -->\nDevOps (scheduled): **Core scoreboard** (production, 24 h)", created_at: "2026-10-26T03:37:00Z", html_url: "c2" },
    ];
    expect(latestWord(comments, [])?.url).toBe("c1");
  });
});

describe("restart-proof start (#384)", () => {
  const md = [
    "| Role | Owns | Hands off |",
    "| --- | --- | --- |",
    "| **Dev** | Create and its tests | Migrations, config |",
    "| **Dev 2** | Editing ads | Same as Dev |",
  ].join("\n");

  it("reads the role card from the docs and resolves 'Same as'", () => {
    expect(roleCard(md, "dev")).toBe("Dev owns: Create and its tests. Hand off: Migrations, config");
    expect(roleCard(md, "dev2")).toBe("Dev 2 owns: Editing ads. Hand off: Migrations, config");
    expect(roleCard(md, "qa")).toBeNull();
  });

  it("lists only your worktrees that hold uncommitted or unpushed work", () => {
    const trees = [
      { path: "/x/adbrain-wt/281", branch: "fix/281-claim", dirty: 2, ahead: 0 },
      { path: "/x/adbrain-wt/dev2-282", branch: "fix/282-confirm", dirty: 0, ahead: 1 },
      { path: "/x/adbrain-wt/371", branch: "dev/371-results", dirty: 0, ahead: 0 },
    ];
    expect(unsavedWork(trees, new Set([281, 371]))).toEqual([trees[0]]);
  });
});

describe("CTO on-track check", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  const issue = (...labels: string[]) => ({ labels: labels.map((name) => ({ name })) });

  it("flags workers with queued work and no recent signed comment, and stale PRs", () => {
    const result = offTrack({
      now,
      issues: [issue("owner:dev"), issue("owner:dev2"), issue("owner:qa")],
      comments: [
        { body: "Dev: PR #365 is ready", created_at: at(20) },
        { body: "CTO: → Dev 2: yours", created_at: at(5) },
        { body: "Dev 2: built in #357", created_at: at(120) },
        { body: "QA verdict at f16e852: approved", created_at: at(30) },
      ],
      prs: [
        { number: 357, title: "#334 Advantage+", updated_at: at(75), draft: false },
        { number: 365, title: "#335 enquiries", updated_at: at(10), draft: false },
      ],
    });
    expect(result.quiet).toEqual([{ role: "dev2", minutes: 120 }]);
    expect(result.stale).toEqual([{ number: 357, title: "#334 Advantage+", minutes: 75 }]);
  });
});

describe("CTO queue watch", () => {
  const issue = (...labels: string[]) => ({ labels: labels.map((name) => ({ name })) });

  it("flags workers with fewer than 3 actionable items (owner, Oct 28), ignoring parked ones", () => {
    const low = lowQueues([
      issue("core", "owner:dev"), issue("owner:dev"),
      issue("owner:dev2"), issue("owner:dev2", "waiting-owner"),
      issue("owner:dev3"), issue("owner:dev3"), issue("owner:dev3", "decision"),
      issue("owner:qa", "owner:dev"), issue("owner:qa"),
    ]);
    expect(low).toEqual([{ role: "dev2", count: 1 }, { role: "dev3", count: 2 }, { role: "dev4", count: 0 }, { role: "qa", count: 2 }, { role: "qa2", count: 0 },
      { role: "reviewer", count: 0 }, { role: "devops", count: 0 }, { role: "cpo", count: 0 }, { role: "analyst", count: 0 }, { role: "designer", count: 0 }, { role: "docs", count: 0 }]);
  });

  it("knows the Docs role (owner, Oct 29): handoffs wake it, and it isn't confused with docs/ paths", () => {
    const docs = matchers("docs");
    expect(waitingOnMe("CEO: → Docs: split API_REFERENCE into docs/api/.", docs)).toBe(true);
    expect(waitingOnMe("Docs: reorganised docs/product/. → CTO: check the ADR link.", docs)).toBe(false);
    expect(docs.addressedToMe("Updated docs/OPERATIONS.md in this PR.")).toBe(false);
    expect(lowQueues([issue("owner:docs", "core")]).find((l) => l.role === "docs")).toEqual({ role: "docs", count: 1 });
  });

  it("counts the worker's lane pool as supply, so a reactive Reviewer with pool audits isn't low", () => {
    const pool = (lane: string) => ({ labels: [{ name: "core" }, { name: "ready" }, { name: `lane:${lane}` }] });
    const low = lowQueues([issue("owner:reviewer"), pool("review"), pool("review"), pool("dev")]).map((l) => l.role);
    expect(low).not.toContain("reviewer");
    expect(low).toContain("dev4");
    expect(low).toContain("qa");
  });
});

describe("wait-for-work handoffs", () => {
  const devops = matchers("devops");
  const dev = matchers("dev");

  it("treats a PR whose title names an owned issue as linked (#309 → #274)", () => {
    expect(linkedIssues("#274 Reliable scheduler: Supabase pg_cron runs enforce-spend")).toEqual([274]);
    expect(linkedIssues("chore(deps): latest dependencies")).toEqual([]);
  });

  it("wakes the owner when someone else spoke last without handing off elsewhere", () => {
    expect(waitingOnMe("QA verdict at d44e9c4: **approved**. Migration sha256 unchanged.", devops)).toBe(true);
    expect(waitingOnMe(null, devops)).toBe(true);
  });

  it("wakes the owner when addressed, even alongside another role", () => {
    expect(waitingOnMe("CTO review: **approved**. → DevOps: release once QA names d44e9c4.", devops)).toBe(true);
  });

  it("stays quiet when the last word is the owner's own or a handoff to someone else", () => {
    expect(waitingOnMe("DevOps: → QA: ready at adbc563.", devops)).toBe(false);
    expect(waitingOnMe("QA: approved at e1f423c. → CTO: review (tenant boundary).", devops)).toBe(false);
  });

  it("resumes an item whose last word is your own progress note without a handoff", () => {
    expect(waitingOnMe("Dev 2: #537 is merged; #538 next.", matchers("dev2"))).toBe(true);
    expect(waitingOnMe("Dev 2: ready at e34663c. → QA: review the tenant check.", matchers("dev2"))).toBe(false);
  });

  it("ignores items parked on the owner or outside the team", () => {
    expect(waitingOnMe("CEO: please submit", devops, ["core", "waiting-owner"])).toBe(false);
  });

  it("keeps Dev distinct from Dev 2, Dev 3 and DevOps", () => {
    expect(dev.writtenByMe("Dev 2: slice 3 is finished")).toBe(false);
    expect(waitingOnMe("CTO: → Dev 2: yours now.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → DevOps: clear the claim.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → Dev: yours, queue #1.", dev)).toBe(true);
  });
});

describe("team board row", () => {
  const board = "## Worker queues (in order)\n\n| Worker | Work, in order |\n| --- | --- |\n| Everyone | When idle: wait. |\n| Dev | 1. #522. 2. #525. |\n| Dev 2 | 1. [#521](https://x/521) provisioning. |\n";
  it("returns the worker's own row, not a prefix match, plus the Everyone row", () => {
    expect(boardRow(board, "dev")).toBe("Everyone: When idle: wait.\nDev: 1. #522. 2. #525.");
    expect(boardRow(board, "dev2")).toBe("Everyone: When idle: wait.\nDev 2: 1. [#521](https://x/521) provisioning.");
    expect(boardRow(board, "qa")).toBe("Everyone: When idle: wait.");
    expect(boardRow("no table", "dev")).toBeNull();
    expect(boardRow("| QA | review |\n| QA 2 | walk |", "qa2")).toBe("QA 2: walk");
  });
});

describe("Reviewer and QA 2 roles (#575)", () => {
  it("keeps QA distinct from QA 2, and routes Reviewer handoffs", () => {
    const qa = matchers("qa");
    const qa2 = matchers("qa2");
    expect(qa.writtenByMe("QA 2: #157 read at 10:00Z")).toBe(false);
    expect(qa2.writtenByMe("QA 2: #157 read at 10:00Z")).toBe(true);
    expect(waitingOnMe("CTO: → QA 2: walk the run.", qa)).toBe(false);
    expect(waitingOnMe("CTO: → QA 2: walk the run.", qa2)).toBe(true);
    expect(waitingOnMe("Dev: → QA: red test please.", qa2)).toBe(false);
    expect(waitingOnMe("DevOps: → Reviewer: review of abc1234 please.", matchers("reviewer"))).toBe(true);
  });
  it("counts their queues", () => {
    const low = lowQueues([{ labels: [{ name: "owner:qa2" }] }, { labels: [{ name: "owner:reviewer" }] }]).map((x) => x.role);
    expect(low).toContain("qa2");
    expect(low).toContain("reviewer"); // every role keeps ≥ 3 (CEO, #364)
  });
});

describe("scheduled checks: Next read <time> (QA 2, #575)", () => {
  const qa2 = matchers("qa2");
  const body = "QA 2: read at 10:57Z: safe. Next read 2026-10-25T16:00Z; final report after Oct 26 14:24Z.";
  it("keeps your own scheduled item quiet until its time, then wakes you", () => {
    expect(snoozedUntil(body)).toBe(Date.parse("2026-10-25T16:00Z"));
    expect(waitingOnMe(body, qa2, [], Date.parse("2026-10-25T11:00Z"))).toBe(false);
    expect(waitingOnMe(body, qa2, [], Date.parse("2026-10-25T16:01Z"))).toBe(true);
  });
  it("ignores the marker in someone else's comment, and unparseable times", () => {
    expect(waitingOnMe("Dev 3: → QA 2: gates please. Next read 2026-10-25T16:00Z.", qa2, [], Date.parse("2026-10-25T11:00Z"))).toBe(true);
    expect(snoozedUntil("QA 2: Next read ~16:00Z")).toBeNull();
    expect(snoozedUntil("QA 2: next check 2026-10-26 14:24Z")).toBe(Date.parse("2026-10-26T14:24Z"));
  });
});

describe("ready pool (#573)", () => {
  const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) });
  const pool = [
    issue(10, "ready", "lane:dev"),
    issue(11, "ready", "lane:dev", "core"),
    issue(12, "ready", "lane:dev", "owner:dev2"),
    issue(13, "ready", "lane:qa"),
    issue(14, "ready", "lane:dev", "blocked"),
    issue(15, "lane:dev"),
  ];
  it("offers the lane's unclaimed items, core first, to every role in the lane", () => {
    expect(readyPool(pool, "dev3").map((i) => i.number)).toEqual([11, 10]);
    expect(readyPool(pool, "qa2").map((i) => i.number)).toEqual([13]);
    expect(readyPool(pool, "devops")).toEqual([]);
    expect(readyPool(pool, "cto")).toEqual([]);
  });
  it("gives the Designer, CPO and Analyst their own lanes (#364)", () => {
    const lanes = [issue(20, "ready", "lane:design"), issue(21, "ready", "lane:product"), issue(22, "ready", "lane:research")];
    expect(readyPool(lanes, "designer").map((i) => i.number)).toEqual([20]);
    expect(readyPool(lanes, "cpo").map((i) => i.number)).toEqual([21]);
    expect(readyPool(lanes, "analyst").map((i) => i.number)).toEqual([22]);
  });
});

describe("Dev 4 role", () => {
  it("keeps Dev distinct from Dev 4, and routes Dev 4 handoffs", () => {
    const dev = matchers("dev");
    const dev4 = matchers("dev4");
    expect(dev.writtenByMe("Dev 4: Review step plan")).toBe(false);
    expect(dev4.writtenByMe("Dev 4: Review step plan")).toBe(true);
    expect(waitingOnMe("CTO: → Dev 4: take #688.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → Dev 4: take #688.", dev4)).toBe(true);
  });
  it("counts Dev 4's queue", () => {
    expect(lowQueues([]).map((x) => x.role)).toContain("dev4");
  });
});

describe("systemic CI failures (CTO auto-track)", () => {
  const run = (name: string, branch: string, conclusion = "failure", event = "pull_request") => ({ name, head_branch: branch, conclusion, event, html_url: `u-${branch}` });
  it("flags one workflow failing on 2+ PR branches, not a single PR's red run or push runs", () => {
    const lines = systemicFailures([
      run("Core approval", "dev3/701"), run("Core approval", "designer/847"), run("Core approval", "dev3/701"),
      run("CI", "dev2/773"), run("CI", "next", "failure", "push"), run("CI", "x", "success"),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^CI systemic: Core approval failed on 2 PR branches \(dev3\/701, designer\/847\)/);
  });
});

describe("next item (#364: idle with a full queue)", () => {
  const issue = (number: number, ...labels: string[]) => ({ number, title: `item ${number}`, labels: labels.map((name) => ({ name })) });
  it("returns the oldest owned item that is actionable and has no open PR, even when its last word was a handoff", () => {
    const items = [issue(30, "core"), issue(12, "core", "parked"), issue(14, "later"), issue(15, "waiting-owner"), issue(16, "decision"), issue(20, "core"), issue(25)];
    const pulls = [{ title: "#20: the fix" }];
    expect(nextItem(items, pulls)?.number).toBe(25);
    expect(nextItem(items, pulls, new Set([25]))?.number).toBe(30);
    expect(nextItem([issue(12, "parked")], [])).toBeNull();
    // Standing channels and umbrellas (#364, #418) are never "your next item".
    expect(nextItem([issue(364, "standing"), issue(400, "core")], [])?.number).toBe(400);
  });
  it("parked items don't count toward a queue", () => {
    expect(lowQueues([issue(1, "owner:dev"), issue(2, "owner:dev", "parked")]).map((l) => l.role)).toContain("dev");
  });
});

describe("waiter fixes (#1478)", () => {
  it("an edited comment isn't new: only comments created since the wait began count", () => {
    const since = "2026-10-28T09:08:00Z";
    const comments = [
      { id: 1, created_at: "2026-10-28T09:07:10Z", updated_at: "2026-10-28T09:25:49Z", body: "Dev 3: runbook" },
      { id: 2, created_at: "2026-10-28T09:10:00Z", updated_at: "2026-10-28T09:10:00Z", body: "QA 2: read" },
    ];
    expect(freshComments(comments, since).map((c) => c.id)).toEqual([2]);
  });
  it("on a co-owned issue, an un-arrowed FYI isn't waiting on every owner; one that names you is", () => {
    const qa2 = matchers("qa2");
    const coOwned = ["core", "owner:qa2", "owner:dev3"];
    expect(waitingOnMe("CPO: Review gap filed as #1198 (Dev 4).", qa2, coOwned)).toBe(false);
    expect(waitingOnMe("CPO: → QA 2: please re-read the arm.", qa2, coOwned)).toBe(true);
    expect(waitingOnMe("CPO: Review gap filed as #1198 (Dev 4).", qa2, ["core", "owner:qa2"])).toBe(true);
  });
  it("a ready item a role declined (declined:<role>) isn't offered to that role again", () => {
    const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) });
    const pool = [issue(1228, "core", "ready", "lane:qa", "declined:qa2"), issue(1230, "core", "ready", "lane:qa")];
    expect(readyPool(pool, "qa2").map((i) => i.number)).toEqual([1230]);
    expect(readyPool(pool, "qa").map((i) => i.number)).toEqual([1228, 1230]);
  });
});

describe("shared GitHub budget (#2021)", () => {
  const now = Date.parse("2026-10-28T21:40:00Z");
  const response = (status: number, headers: Record<string, string>, body = "") =>
    `HTTP/2.0 ${status}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n${body}`;

  it("revalidates each URL with its ETag and reuses the body only on 304", async () => {
    const request = vi.fn()
      .mockReturnValueOnce(response(200, { ETag: '"one"' }, '[{"number":2021}]'))
      .mockReturnValueOnce(response(200, { ETag: '"other"' }, "[]"))
      .mockReturnValueOnce(response(304, {}))
      .mockReturnValueOnce(response(200, { ETag: '"two"' }, '[{"number":2022}]'))
      .mockReturnValueOnce(response(304, {}));
    const client = createGitHubApi({ request });
    expect(await client.get("issues")).toEqual([{ number: 2021 }]);
    expect(await client.get("pulls")).toEqual([]);
    expect(await client.get("issues")).toEqual([{ number: 2021 }]);
    expect(await client.get("issues")).toEqual([{ number: 2022 }]);
    expect(await client.get("issues")).toEqual([{ number: 2022 }]);
    expect(request.mock.calls).toEqual([
      [["api", "--include", "issues"]],
      [["api", "--include", "pulls"]],
      [["api", "--include", "issues", "-H", 'If-None-Match: "one"']],
      [["api", "--include", "issues", "-H", 'If-None-Match: "one"']],
      [["api", "--include", "issues", "-H", 'If-None-Match: "two"']],
    ]);
  });

  it.each([403, 429])("retries HTTP %i after x-ratelimit-reset, including gh's nonzero exit", async (status) => {
    let clock = now;
    const failure = Object.assign(new Error("gh failed"), {
      stdout: response(status, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 120) }, '{"message":"API rate limit exceeded"}'),
    });
    const request = vi.fn().mockImplementationOnce(() => { throw failure; })
      .mockImplementation(() => {
        expect(clock).toBeGreaterThanOrEqual(now + 125_000);
        return response(200, {}, '[{"number":2021}]');
      });
    const sleep = vi.fn(async (ms: number) => { clock += ms; });
    const warn = vi.fn();
    const client = createGitHubApi({ request, sleep, now: () => clock, warn });
    expect(await client.get("issues")).toEqual([{ number: 2021 }]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rate limit"));
  });

  it("honours Retry-After for secondary limits and backs off when headers are missing", async () => {
    let clock = now;
    const request = vi.fn()
      .mockReturnValueOnce(response(429, { "Retry-After": "180" }, '{"message":"slow down"}'))
      .mockReturnValueOnce(response(403, {}, '{"message":"secondary rate limit"}'))
      .mockImplementation(() => {
        expect(clock).toBeGreaterThanOrEqual(now + 240_000);
        return response(200, {}, "[]");
      });
    const client = createGitHubApi({ request, sleep: async (ms: number) => { clock += ms; }, now: () => clock, warn: vi.fn() });
    expect(await client.get("issues")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("surfaces non-rate-limit 403s without retrying", async () => {
    const sleep = vi.fn();
    const client = createGitHubApi({
      request: () => response(403, {}, '{"message":"Resource not accessible"}'),
      sleep,
    });
    await expect(client.get("issues")).rejects.toThrow("Resource not accessible");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry before the primary reset when Retry-After is shorter", async () => {
    let clock = now;
    const request = vi.fn()
      .mockReturnValueOnce(response(403, {
        "retry-after": "1", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 120),
      }, '{"message":"API rate limit exceeded"}'))
      .mockImplementation(() => {
        expect(clock).toBeGreaterThanOrEqual(now + 125_000);
        return response(200, {}, "[]");
      });
    const client = createGitHubApi({ request, sleep: async (ms: number) => { clock += ms; }, now: () => clock, warn: vi.fn() });
    expect(await client.get("issues")).toEqual([]);
  });

  it("falls back to a real delay for malformed Retry-After instead of a tight retry loop", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const request = vi.fn()
      .mockReturnValueOnce(response(429, { "retry-after": "invalid" }))
      .mockReturnValueOnce(response(200, {}, "[]"));
    const client = createGitHubApi({ request, sleep, warn: vi.fn() });
    expect(await client.get("issues")).toEqual([]);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(60_000);
  });

  it("drops the old ETag when a changed response stops supplying one", async () => {
    const request = vi.fn()
      .mockReturnValueOnce(response(200, { ETag: '"one"' }, "[1]"))
      .mockReturnValueOnce(response(200, {}, "[2]"))
      .mockReturnValueOnce(response(200, {}, "[3]"));
    const client = createGitHubApi({ request });
    await client.get("issues");
    expect(await client.get("issues")).toEqual([2]);
    expect(await client.get("issues")).toEqual([3]);
    expect(request.mock.calls[2]).toEqual([["api", "--include", "issues"]]);
  });

  it("uses response headers to slow polling without a rate_limit request", async () => {
    const request = vi.fn().mockReturnValue(response(200, {
      "x-ratelimit-remaining": "800", "x-ratelimit-reset": String(now / 1000 + 120),
    }, "[]"));
    const client = createGitHubApi({ request, now: () => now });
    await client.get("issues");
    expect(client.pollDelay(300_000)).toBe(900_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits for the reset when the budget is spent, slows down when it's low, else adds nothing", () => {
    const reset = now / 1000 + 120;
    const spent = rateBackoffMs({ remaining: 0, reset }, 90_000, now);
    expect(spent).toBeGreaterThanOrEqual(125_000);
    expect(spent).toBeLessThan(155_000);
    expect(rateBackoffMs({ remaining: 800, reset }, 90_000, now)).toBe(180_000);
    expect(rateBackoffMs({ remaining: 4_000, reset }, 90_000, now)).toBe(0);
  });
});
