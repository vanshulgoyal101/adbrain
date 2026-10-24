import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { skillMap, skillsFor } from "../scripts/wait-for-work.mjs";
import { toSkillMd } from "../scripts/sync-own-skills.mjs";

const map = skillMap(readFileSync("AGENTS.md", "utf8"));

describe("task → skill map (#408)", () => {
  it("is read from AGENTS.md and every skill it names exists", () => {
    expect(map.length).toBeGreaterThanOrEqual(10);
    for (const skill of map.flatMap((row) => row.skills)) {
      expect(existsSync(`.github/skills/${skill}/SKILL.md`), skill).toBe(true);
    }
  });

  it("every synced own skill is listed and has a description", () => {
    const { skills } = JSON.parse(readFileSync(".github/skills/own-skills.json", "utf8")) as { skills: string[] };
    for (const name of skills) {
      const text = readFileSync(`.github/skills/${name}/SKILL.md`, "utf8");
      expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: ".{20,}"\\n---`));
    }
  });

  it("picks skills by title and labels", () => {
    expect(skillsFor(map, "Phone: remove dead space (sign-up intro story)", ["core"])).toEqual(["frontend-design", "web-design-guidelines"]);
    expect(skillsFor(map, "Database hardening from Supabase advisors", ["core"])).toEqual(["supabase-postgres-best-practices", "supabase-rls-complete"]);
    expect(skillsFor(map, "Create assistant fails: AllLLMProvidersFailedError (Groq + Gemini)", ["bug"])).toEqual(["systematic-debugging", "task-aware-llm-routing"]);
    expect(skillsFor(map, "Roles: read your role card", [])).toEqual(["multi-worker-delivery", "dispatching-parallel-agents"]);
    expect(skillsFor(map, "Something unrelated", [])).toEqual([]);
  });
});

describe("own skills sync", () => {
  it("adds frontmatter from the Trigger and keeps the body", () => {
    const out = toSkillMd("x-skill", "# X\n\n## Trigger\n\nUse when the thing\nhappens twice.\n\n## Invariant\n\nBody.\n", "repo@abc skills/x-skill.md");
    expect(out.startsWith('---\nname: x-skill\ndescription: "Use when the thing happens twice."\n---\n')).toBe(true);
    expect(out).toContain("## Invariant\n\nBody.");
  });
});
