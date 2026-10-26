import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { firstPrompt, liveRoles, pickRole, prompt, restartPrompt, roleFromPrompt, runsToday } from "../scripts/team-supervisor.mjs";

const dir = mkdtempSync(join(tmpdir(), "supervisor-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function session(id: string, text: string, minutesAgo: number) {
  mkdirSync(join(dir, id));
  const file = join(dir, id, "events.jsonl");
  writeFileSync(file, `${JSON.stringify({ type: "session.start", data: {} })}\n${JSON.stringify({ type: "user.message", data: { content: text } })}\n`);
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
    expect([...liveRoles(dir, 20)]).toEqual(["qa"]);
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
    expect(text).toContain('"Dev 2:"');
    expect(() => restartPrompt("nobody")).toThrow();
  });
});
