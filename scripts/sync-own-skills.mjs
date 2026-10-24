#!/usr/bin/env node
// Copies AdBrain-relevant skills from our own skills repo (vanshulgoyal101/skills) into
// .github/skills/<name>/SKILL.md, pinned to the commit in .github/skills/own-skills.json.
// The body is unchanged; only Anthropic-style frontmatter is added so agents can load it.
// Update: change "sha" (and the list) in own-skills.json, then run `node scripts/sync-own-skills.mjs`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** SKILL.md text for one of our single-file skills: name from the file, description from its Trigger. */
export function toSkillMd(name, markdown, source) {
  const trigger = /^## Trigger\s*\n+([\s\S]*?)(?:\n\s*\n|\n## )/m.exec(markdown)?.[1] ?? "";
  const description = trigger.replace(/\s+/g, " ").trim() || `See ${name}.`;
  const quoted = JSON.stringify(description);
  return `---\nname: ${name}\ndescription: ${quoted}\n---\n\n<!-- Generated from ${source}; edit upstream, then re-run scripts/sync-own-skills.mjs. -->\n\n${markdown.trimEnd()}\n`;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(join(root, ".github/skills/own-skills.json"), "utf8"));
  for (const name of manifest.skills) {
    const url = `https://raw.githubusercontent.com/${manifest.repo}/${manifest.sha}/skills/${name}.md`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: ${response.status} from ${url}`);
    const dir = join(root, ".github/skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), toSkillMd(name, await response.text(), `${manifest.repo}@${manifest.sha.slice(0, 7)} skills/${name}.md`));
    console.log(`synced ${name}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
