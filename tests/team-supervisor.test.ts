import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { firstPrompt, lastWords, liveRoles, pickRole, prompt, restartPrompt, roleFromPrompt, runsToday, scheduledJobsDue, exportDue, exportsToPrune } from "../scripts/team-supervisor.mjs";

const dir = mkdtempSync(join(tmpdir(), "supervisor-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function session(id: string, text: string, minutesAgo: number, last: string[] = []) {
  mkdirSync(join(dir, id));
  const file = join(dir, id, "events.jsonl");
  const tail = last.map((type) => `${JSON.stringify({ type, data: {} })}\n`).join("");
  writeFileSync(file, `${JSON.stringify({ type: "session.start", data: {} })}\n${JSON.stringify({ type: "user.message", data: { content: text } })}\n${tail}`);
  const t = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(file, t, t);
}

describe("team-supervisor (#573 A1)", () => {
  it("maps a chat's first prompt to its role, longest name first", () => {
    expect(roleFromPrompt("You are AdBrain's Dev 2. Your old chat…")).toBe("dev2");
    expect(roleFromPrompt("> You are AdBrain's DEV. Your old chat broke")).toBe("dev");
    expect(roleFromPrompt("You are AdBrain's QA 2. Read")).toBe("qa2");
    expect(roleFromPrompt("You are AdBrain's DevOps. Rea")).toBe("devops");
    expect(roleFromPrompt("You are AdBrain's QA, started headless")).toBe("qa");
    expect(roleFromPrompt("hello")).toBeNull();
    expect(roleFromPrompt("You are AdBrain's Product Designer, a new role")).toBe("designer");
    expect(roleFromPrompt("You are AdBrain's Competitive Intelligence Analyst. Your pre")).toBe("analyst");
    expect(roleFromPrompt("You are AdBrain's Dev 4 (owner of the pre-launch Review step)")).toBe("dev4");
    expect(roleFromPrompt("You are AdBrain's CPO (product research and the ranked roadmap)")).toBe("cpo");
    expect(roleFromPrompt("You are AdBrain's CTO helper for epic #744")).toBeNull();
  });

  it("reads the first user message from an events.jsonl head", () => {
    const head = `{"type":"session.start"}\n{"type":"user.message","data":{"content":"You are AdBrain's CTO."}}\n{"type":"user.message","data":{"content":"later"}}`;
    expect(firstPrompt(head)).toBe("You are AdBrain's CTO.");
    expect(firstPrompt("{\"type\":\"session.start\"}")).toBeNull();
  });

  it("counts a role live only if its chat wrote recently", () => {
    session("a", "You are AdBrain's QA. Read AGENTS.md", 5);
    session("b", "You are AdBrain's DevOps. Read", 45);
    session("c", "Unrelated chat", 1);
    // Finished its turn 2 min ago and never started its waiter: idle, not live (CEO, 14:25Z).
    session("d", "You are AdBrain's Dev 4 (owner of the Review step).", 2, ["assistant.turn_start", "tool.execution_complete", "assistant.turn_end", "hook.start", "hook.end", "session.usage_checkpoint"]);
    session("e", "You are AdBrain's Product Designer (issue #847).", 1, ["assistant.turn_start", "tool.execution_start"]);
    expect([...liveRoles(dir, 20)].sort()).toEqual(["designer", "qa"]);
  });

  it("wakes the first role in order with work and no live chat", () => {
    const statuses = {
      devops: { state: "waiting", items: [] },
      qa: { state: "has-work", items: ["#643 review"] },
      reviewer: { state: "has-work", items: ["#673 audit"] },
    };
    expect(pickRole(statuses, new Set(["qa"]))).toEqual({ role: "reviewer", items: ["#673 audit"] });
    expect(pickRole(statuses, new Set(["qa", "reviewer"]))).toBeNull();
  });

  it("counts only today's runs toward the daily cap", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(runsToday({ runs: [{ start: "2026-10-26T01:00:00Z" }, { start: "2026-10-25T23:00:00Z" }] }, now)).toBe(1);
  });

  it("briefs one item with the hard limits and a signed role", () => {
    const text = prompt("qa", ["#643 verdict", "#668 red test"], 40);
    expect(text).toContain("You are AdBrain's QA, started headless");
    expect(text).toContain("- #643 verdict");
    expect(text).toContain('"QA (headless):"');
    expect(text).toMatch(/no Meta writes or ad activation/);
    expect(text).toMatch(/Never run wait-for-work/);
  });

  it("gives each role a restart prompt that maps back to the same role", () => {
    const text = restartPrompt("dev2");
    expect(roleFromPrompt(text)).toBe("dev2");
    expect(text).toContain("-l owner:dev2");
    expect(text).toContain("wait-for-work.mjs --me dev2");
    expect(text).toMatch(/never completes: do not call task_complete/);
    expect(text).toContain('"Dev 2:"');
    expect(() => restartPrompt("nobody")).toThrow();
  });
});

describe("scheduled-jobs dispatch (#692)", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  it("dispatches when GitHub's schedule has lapsed over 14 min, or there is no run yet", () => {
    expect(scheduledJobsDue({ createdAt: "2026-10-26T07:01:50Z", status: "completed" }, now)).toBe(true);
    expect(scheduledJobsDue({ createdAt: "2026-10-26T11:45:00Z", status: "completed" }, now)).toBe(true);
    expect(scheduledJobsDue(undefined, now)).toBe(true);
  });
  it("waits while a recent run exists or one is queued or running", () => {
    expect(scheduledJobsDue({ createdAt: "2026-10-26T11:50:00Z", status: "completed" }, now)).toBe(false);
    expect(scheduledJobsDue({ createdAt: "2026-10-26T07:00:00Z", status: "in_progress" }, now)).toBe(false);
    expect(scheduledJobsDue({ createdAt: "2026-10-26T07:00:00Z", status: "queued" }, now)).toBe(false);
  });

  it("logs a run's final words, so a short run shows what it decided", () => {
    expect(lastWords("I'll check #741.\n\nThe 24 h read isn't due until 2026-10-27T11:19Z; posted that on #741.\n")).toBe("The 24 h read isn't due until 2026-10-27T11:19Z; posted that on #741.");
    expect(lastWords("")).toBe("(no output)");
  });
});

describe("nightly export (#884)", () => {
  it("runs once a night, after 20:00Z, and catches up after the Mac slept through it", () => {
    expect(exportDue("2026-10-25T20:10:00Z", new Date("2026-10-26T19:59:00Z"))).toBe(false);
    expect(exportDue("2026-10-26T16:38:00Z", new Date("2026-10-27T09:47:00Z"))).toBe(true);
    expect(exportDue(null, new Date("2026-10-26T20:05:00Z"))).toBe(true);
    expect(exportDue("2026-10-25T20:10:00Z", new Date("2026-10-26T20:05:00Z"))).toBe(true);
    expect(exportDue("2026-10-26T20:10:00Z", new Date("2026-10-26T23:00:00Z"))).toBe(false);
    expect(exportDue("2026-10-26T20:10:00Z", new Date("2026-10-27T03:00:00Z"))).toBe(false);
  });
  it("keeps the newest 7 export folders and ignores anything else", () => {
    const names = Array.from({ length: 9 }, (_, i) => `2026-10-${String(18 + i).padStart(2, "0")}T20-10Z`);
    expect(exportsToPrune([...names, "notes.txt"])).toEqual(["2026-10-19T20-10Z", "2026-10-18T20-10Z"]);
    expect(exportsToPrune(names.slice(0, 3))).toEqual([]);
  });
});
