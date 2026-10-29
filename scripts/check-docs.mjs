import { readFileSync, readdirSync, existsSync, statSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";
import { parse as parseHtml } from "node-html-parser";
import ts from "typescript";

const markdown = new MarkdownIt({ html: true });
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function classification(file) {
  return file.startsWith("docs/qa/") || file.startsWith("docs/releases/") ||
    file.startsWith("docs/meta-connect-workers/") ||
    /-HISTORY-\d{4}-\d{2}-\d{2}\.md$/.test(file)
    ? "historical" : "current";
}

function inlineText(tokens = []) {
  return tokens.map(token => token.children ? inlineText(token.children)
    : token.type === "html_inline" ? parseHtml(token.content).text : token.content).join("");
}

function parseDocument(file) {
  const text = readFileSync(file, "utf8");
  const tokens = markdown.parse(text, {});
  const slugger = new GithubSlugger();
  const anchors = new Set();
  const links = [];
  const examples = [];
  const unclosedFences = [];
  const prose = [];
  const inspect = (items, parentLine = 1) => {
    for (let index = 0; index < items.length; index++) {
      const token = items[index];
      const line = token.map ? token.map[0] + 1 : parentLine;
      if (token.type === "heading_open") anchors.add(slugger.slug(inlineText(items[index + 1]?.children)));
      if (token.type === "link_open" || token.type === "image") {
        links.push({ href: token.attrGet(token.type === "image" ? "src" : "href"), line });
      }
      if (token.type === "html_inline" || token.type === "html_block") {
        const html = parseHtml(token.content);
        for (const element of html.querySelectorAll("[id], a[name]")) anchors.add(element.getAttribute("id") ?? element.getAttribute("name"));
        for (const element of html.querySelectorAll("a[href], img[src]")) links.push({ href: element.getAttribute("href") ?? element.getAttribute("src"), line });
      }
      if (token.type === "fence" || token.type === "code_inline") examples.push({ content: token.content, language: token.info?.trim().split(/\s+/)[0], line });
      if (token.type === "fence") {
        const lastLine = text.split("\n")[token.map[1] - 1]?.trim().replace(/^(?:>\s*)+/, "") ?? "";
        if (!lastLine.startsWith(token.markup) || lastLine.split(token.markup[0]).join("").trim()) unclosedFences.push(line);
      }
      if (token.type === "inline") prose.push({ line, text: token.children.map(child => /break$/.test(child.type) ? " " : child.type === "code_inline" ? "" : child.type === "html_inline" ? parseHtml(child.content).text : child.content).join("") });
      if (token.children) inspect(token.children, line);
    }
  };
  inspect(tokens);
  return { text, anchors, links, examples, unclosedFences, prose };
}

export function sourceInventory(root) {
  const routes = [];
  const environment = new Set();
  for (const path of walk(resolve(root, "src")).filter(file => /\.[cm]?tsx?$/.test(file))) {
    const text = readFileSync(path, "utf8");
    const file = relative(root, path).split(sep).join("/");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const verbs = new Set();
    const visit = node => {
      if (ts.isPropertyAccessExpression(node) && ["process.env", "env", "environment"].includes(node.expression.getText(source)) &&
        /^[A-Z][A-Z0-9_]+$/.test(node.name.text)) environment.add(node.name.text);
      if (ts.isElementAccessExpression(node) && ["process.env", "env", "environment"].includes(node.expression.getText(source)) &&
        node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) environment.add(node.argumentExpression.text);
      if (file === "src/lib/env.ts" && ts.isPropertyAssignment(node) && /^[A-Z][A-Z0-9_]+$/.test(node.name.getText(source))) environment.add(node.name.getText(source));
      const exported = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && ts.isFunctionDeclaration(node) && node.name && methods.has(node.name.text)) verbs.add(node.name.text);
      if (exported && ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) if (methods.has(declaration.name.getText(source))) verbs.add(declaration.name.getText(source));
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) if (methods.has(element.name.text)) verbs.add(element.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (file.startsWith("src/app/api/") && file.endsWith("/route.ts")) {
      routes.push({ path: "/" + file.slice("src/app/".length, -"/route.ts".length).split("/").filter(part => !/^\(.*\)$/.test(part)).join("/"), methods: [...verbs].sort(), file });
    }
  }
  const exampleEnvironment = resolve(root, ".env.example");
  if (existsSync(exampleEnvironment)) {
    for (const match of readFileSync(exampleEnvironment, "utf8").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) environment.add(match[1]);
  }
  const migrations = walk(resolve(root, "db/migrations")).filter(file => file.endsWith(".sql")).map(file => relative(root, file).split(sep).join("/")).sort();
  const tables = new Set();
  for (const file of [...migrations, "db/schema.sql"].filter(file => existsSync(resolve(root, file)))) {
    for (const match of readFileSync(resolve(root, file), "utf8").matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.|private\.)?[a-z_][a-z0-9_]*)/gi)) tables.add(match[1]);
  }
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return { commands: Object.keys(packageJson.scripts ?? {}).sort(), routes, environment: [...environment].sort(), migrations, tables: [...tables].sort() };
}

// Layered docs (#1851): pages stay short, every folder has an index, and only these sit directly in docs/.
export const MAX_LINES = 300;
export const TOP_LEVEL = new Set(["docs/README.md", "docs/roadmap.md"]);
const CODE_DIRS = ["src", "scripts", "db", ".github"];
const CODE_FILES = ["AGENTS.md", ".env.example", "package.json"];

/** Route-inventory rows (`| GET/POST | \`/api/x?q\` | …`) in one page: path without query, with line. */
export function routeRows(text) {
  return [...text.matchAll(/^\|\s*[A-Z]+(?:\/[A-Z]+)*\s*\|\s*`(\/api\/[^`?\s]+)[^`]*`/gm)]
    .map(match => ({ path: match[1], line: text.slice(0, match.index).split("\n").length }));
}

// #2252: a "quoted" label in docs/product must exist in the app (src, messages, db/migrations). Compared as word
// trigrams: an app slot ({x}, ${x}) matches one word; a doc placeholder (…, N, n, X, Y, [x], {x}, numbers) is skipped.
// "Owner says:" lines quote customers; LABEL_PROSE lists example text that isn't app copy.
export const LABEL_PROSE = new Set(["Cures back pain", "Hi, I want info", "Can I get PM Surya Ghar subsidy help?", "fresh direction", "ignore preferences",
  // setup-go-live.tsx renders hintBefore + <strong>adBrain</strong> + hintAfter.
  "Facebook is still reviewing AdBrain. Until then, your Facebook account needs our invite: open your invites and accept adBrain, then tap Connect."]);
const SLOT = "§";
const words = text => (text.replace(/[‘’]/g, "'").replace(/&apos;|&rsquo;|&#39;/g, "'").toLowerCase().match(/[\p{L}\p{M}\p{N}'§]+/gu) ?? [])
  .map(word => word.replace(/^'+|'+$/g, "")).filter(Boolean).map(word => /^\d+[a-z]{0,2}$/.test(word) || /^[nxy]$/.test(word) ? SLOT : word);
export function appCopy(root) {
  const files = [...walk(resolve(root, "src")).filter(file => /\.(?:tsx?|json)$/.test(file) && !/\.test\./.test(file)), ...walk(resolve(root, "messages")), ...walk(resolve(root, "db/migrations"))];
  const grams = new Set();
  for (const file of files) {
    const list = words(readFileSync(file, "utf8").replace(/\$\{[^{}`]*\}|\{[\w.]{1,40}\}|#/g, ` ${SLOT} `));
    list.forEach((word, index) => { for (let size = 1; size <= 3 && index + size <= list.length; size++) grams.add(list.slice(index, index + size).join(" ")); });
  }
  return grams;
}
const known = (gram, grams) => [-1, ...gram.keys()].some(slot => grams.has(gram.map((word, index) => index === slot ? SLOT : word).join(" ")));
export function missingLabels(texts, grams) {
  const missing = [];
  for (const { line, text } of texts) {
    if (/^\s*Owner says:/.test(text)) continue;
    // Quotes after "reply:" are support's words, and labels without Latin letters are customer words or Hindi.
    for (const [, before, label] of text.replace(/“[^”]*”/g, ` ${SLOT} `).matchAll(/([^\s"]*\s?)"([^"]{1,200})"/g)) {
      if (LABEL_PROSE.has(label.trim()) || /(?:reply|दें):\s?$/i.test(before) || !/[a-z]/i.test(label) || /[\u0900-\u097F]/.test(label)) continue;
      // "·" and sentence ends usually separate UI elements, so each piece is checked on its own.
      const pieces = label.replace(/…|\.\.\.|\[[^\]]*\]|\{[^}]*\}/g, ` ${SLOT} `).split(/·|[.?!;:](?:\s|$)/).map(words);
      const checks = pieces.flatMap(list => list.map((_, index) => list.slice(index, index + Math.min(3, list.length)))
        .filter(gram => gram.length === Math.min(3, list.length) && !gram.includes(SLOT)));
      if (checks.some(gram => !known(gram, grams))) missing.push({ line, label });
    }
  }
  return missing;
}

// #2267: scheduled-jobs.md lists every schedule: a table row naming the source (workflow file, vercel.json path or
// pg_cron job) and its cron in code spans. Sources: `cron:` lines in workflows, vercel.json crons, and the last
// cron.schedule/unschedule per job across db/migrations in file order.
const CRON = /^[\d*,/-]+(?: [\d*,/-]+){4}$/;
export function scheduleDrift(root, markdown) {
  const actual = new Set();
  const workflows = resolve(root, ".github/workflows");
  for (const path of walk(workflows).filter(file => /\.ya?ml$/.test(file))) {
    for (const [, cron] of readFileSync(path, "utf8").matchAll(/^\s*-?\s*cron:\s*["']([^"']+)["']/gm)) actual.add(`${relative(workflows, path)} ${cron}`);
  }
  if (existsSync(resolve(root, "vercel.json"))) {
    for (const { path, schedule } of JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")).crons ?? []) actual.add(`${path} ${schedule}`);
  }
  const jobs = new Map();
  for (const path of walk(resolve(root, "db/migrations")).filter(file => file.endsWith(".sql")).sort()) {
    for (const [, name, cron] of readFileSync(path, "utf8").matchAll(/cron\.(?:un)?schedule\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?/g)) cron ? jobs.set(name, cron) : jobs.delete(name);
  }
  for (const [name, cron] of jobs) actual.add(`${name} ${cron}`);
  const documented = new Map();
  markdown.split("\n").forEach((text, index) => {
    if (!text.startsWith("|")) return;
    const spans = [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    const key = spans.find(span => /\.ya?ml$|^\/api\/cron\/|^adbrain-/.test(span));
    for (const cron of spans.filter(span => CRON.test(span))) if (key) documented.set(`${key} ${cron}`, index + 1);
  });
  return [
    ...[...actual].filter(entry => !documented.has(entry)).map(entry => ({ line: 1, message: `Schedule missing from the table: \`${entry}\`` })),
    ...[...documented].filter(([entry]) => !actual.has(entry)).map(([entry, line]) => ({ line, message: `Documented schedule no longer exists: \`${entry}\`` })),
  ];
}

// #2277: each docs/product/hi page carries `<!-- mirrors ../x.md <hash> -->` under its H1. The hash covers the English
// page's headings and quoted labels, so a changed step or label names the Hindi page to refresh. Stamp after a refresh
// with `npm run docs:check -- --stamp docs/product/hi/x.md`.
const MIRROR = /<!-- mirrors (\S+\.md) ([0-9a-f]{12}) -->/;
export const isHindiMirror = file => /^docs\/product\/hi\/(?!README\.md$)[^/]+\.md$/.test(file);
export function mirrorHash(markdown) {
  const text = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  const parts = [...text.match(/^#{1,6} .*$/gm) ?? [], ...text.match(/"[^"\n]{1,200}"/g) ?? []].map(part => part.trim());
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
}
export function mirrorDrift(path, markdown) {
  const stamp = markdown.match(MIRROR);
  if (!stamp) return "No mirror stamp: run `npm run docs:check -- --stamp <this file>` once it matches its English page";
  const english = resolve(dirname(path), stamp[1]);
  if (!existsSync(english)) return `Mirrored English page is missing: ${stamp[1]}`;
  return mirrorHash(readFileSync(english, "utf8")) === stamp[2] ? null
    : `${stamp[1]} changed since this translation: update this page, then run \`npm run docs:check -- --stamp <this file>\``;
}
export function stampMirror(path) {
  const markdown = readFileSync(path, "utf8");
  const target = markdown.match(MIRROR)?.[1] ?? markdown.match(/\]\((\.\.\/[^)#\s]+\.md)\)/)?.[1];
  if (!target) throw new Error(`${path}: no link to its English page`);
  const line = `<!-- mirrors ${target} ${mirrorHash(readFileSync(resolve(dirname(path), target), "utf8"))} -->`;
  writeFileSync(path, MIRROR.test(markdown) ? markdown.replace(MIRROR, line) : markdown.replace(/^(# .*\n)/, `$1${line}\n`));
}

export function checkDocumentation(root, options = {}) {
  root = resolve(root);
  const moduleReadmes = walk(resolve(root, "src")).filter(file => file.endsWith(`${sep}README.md`));
  const files = [...["README.md", "AGENTS.md"].map(file => resolve(root, file)).filter(existsSync), ...walk(resolve(root, "docs")).filter(file => file.endsWith(".md")), ...moduleReadmes];
  const inventory = files.map(path => ({ file: relative(root, path).split(sep).join("/"), role: classification(relative(root, path).split(sep).join("/")) }));
  const selected = options.files?.length ? options.files.map(file => resolve(root, file)) : files.filter(file => options.all || classification(relative(root, file).split(sep).join("/")) === "current");
  const source = sourceInventory(root);
  const diagnostics = [];
  const cache = new Map();
  const load = file => {
    if (!cache.has(file)) cache.set(file, parseDocument(file));
    return cache.get(file);
  };
  const checked = [];
  let appText;
  for (const path of selected) {
    const file = relative(root, path).split(sep).join("/");
    if (file.startsWith("../") || !existsSync(path) || !statSync(path).isFile()) {
      diagnostics.push({ severity: "error", file, line: 1, message: "Selected document is outside the root or missing" });
      continue;
    }
    const document = load(path);
    const historical = classification(file) === "historical";
    const report = (line, message, warning = false) => diagnostics.push({ severity: historical || warning ? "warning" : "error", file, line, message });
    checked.push({ file, role: historical ? "historical" : "current", sha256: createHash("sha256").update(document.text).digest("hex") });
    for (const line of document.unclosedFences) report(line, "Unclosed fenced code block");
    if (isHindiMirror(file) && !historical) { const drift = mirrorDrift(path, readFileSync(path, "utf8")); if (drift) report(1, drift); }
    if (file === "docs/operations/scheduled-jobs.md") for (const { line, message } of scheduleDrift(root, readFileSync(path, "utf8"))) report(line, message);
    if (file.startsWith("docs/product/") && !historical) {
      for (const { line, label } of missingLabels(document.prose, appText ??= appCopy(root))) report(line, `Quoted label not in the app: "${label}" (fix it to the app's text, or add example text to LABEL_PROSE)`);
    }
    for (const { href, line } of document.links) {
      if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
      let url;
      try { url = new URL(href, `https://docs.invalid/${file}`); } catch { report(line, "Invalid local link"); continue; }
      let target;
      let anchor;
      try { target = resolve(root, "." + decodeURIComponent(url.pathname)); anchor = decodeURIComponent(url.hash.slice(1)); }
      catch { report(line, "Invalid URL encoding in local link"); continue; }
      if (relative(root, target).startsWith(".." + sep)) { report(line, "Local link escapes repository root"); continue; }
      const local = relative(root, target).split(sep).join("/");
      const privateEvidence = local.startsWith(".qa-artifacts/") || local.startsWith("test-results/");
      if (!existsSync(target)) { report(line, `Missing local target: ${local}`, privateEvidence); continue; }
      if (!anchor || statSync(target).isDirectory()) continue;
      if (/^L\d+(?:-L\d+)?$/.test(anchor)) {
        const numbers = anchor.match(/\d+/g).map(Number);
        if (numbers.some(number => number < 1 || number > readFileSync(target, "utf8").split("\n").length) || numbers[0] > numbers.at(-1)) report(line, `Invalid source line anchor: ${local}#${anchor}`);
      } else if (extname(target) === ".md") {
        if (!load(target).anchors.has(anchor)) report(line, `Missing heading: ${local}#${anchor}`, privateEvidence);
      }
    }
    for (const { content, language, line } of document.examples) {
      if (language === "json") {
        try { JSON.parse(content); } catch { report(line, "Invalid JSON example (values omitted)"); }
      }
      for (const match of content.matchAll(/\bnpm\s+(?:run|run-script)\s+([a-zA-Z0-9:_-]+)/g)) {
        if (!source.commands.includes(match[1])) report(line, `Unknown package command: ${match[1]}`);
      }
      for (const match of content.matchAll(/\bnode\s+(scripts\/[a-zA-Z0-9_./-]+\.[cm]?js)\b/g)) {
        if (!existsSync(resolve(root, match[1]))) report(line, `Missing script: ${match[1]}`);
      }
    }
  }
  const textOf = file => existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), "utf8") : "";
  const docFiles = inventory.filter(entry => entry.role === "current" && entry.file.startsWith("docs/")).map(entry => entry.file);
  const pages = (folder, legacy, match = () => true) => {
    const found = docFiles.filter(file => file.startsWith(folder) && !file.slice(folder.length).includes("/") && match(file));
    return found.length ? found : existsSync(resolve(root, legacy)) ? [legacy] : [];
  };
  const fail = (file, line, message) => diagnostics.push({ severity: "error", file, line, message });
  const configPages = docFiles.filter(file => /^docs\/operations\/configuration[^/]*\.md$/.test(file)).sort((a, b) => a.length - b.length);
  const configText = configPages.map(textOf).join("\n");
  const dataText = textOf("docs/architecture/migrations.md");

  // API: every handler has exactly one inventory row, on one api/ page, and every row has a handler.
  const apiPages = pages("docs/api/", "docs/API_REFERENCE.md");
  const rows = apiPages.flatMap(file => routeRows(textOf(file)).map(row => ({ ...row, file })));
  const routePaths = new Set(source.routes.map(route => route.path));
  if (apiPages.length) {
    for (const route of source.routes) {
      const homes = [...new Set(rows.filter(row => row.path === route.path).map(row => row.file))];
      if (!homes.length) fail(apiPages[0], 1, `API route has no inventory row: ${route.path}`);
      else if (homes.length > 1) fail(homes[1], 1, `API route listed on more than one api page: ${route.path} (${homes.join(", ")})`);
    }
    for (const row of rows) if (!routePaths.has(row.path)) fail(row.file, row.line, `Inventory row for a route with no handler: ${row.path}`);
  }

  // Configuration: every environment key is documented.
  if (configPages.length) for (const name of source.environment) if (!configText.includes(name)) fail(configPages[0], 1, `Environment key not documented: ${name}`);

  // Shape: short pages, an index per folder that links each page, nothing new loose in docs/.
  for (const file of docFiles) {
    const lines = textOf(file).split("\n").length - 1;
    if (lines > MAX_LINES) fail(file, MAX_LINES + 1, `Page has ${lines} lines; split it (limit ${MAX_LINES})`);
    if (!file.slice("docs/".length).includes("/") && !TOP_LEVEL.has(file)) fail(file, 1, "Put pages in a docs/ subfolder (product, architecture, api, operations, team, plans)");
    // A plan is current or deleted: its status (active, or done and due for deletion) sits under the title.
    if (file.startsWith("docs/plans/") && file !== "docs/plans/README.md" && !/^\*\*Status:\*\* (active|done)\b/m.test(textOf(file).split("\n").slice(0, 6).join("\n"))) fail(file, 1, "Plan needs a `**Status:** active` or `**Status:** done` line under its title");
  }
  const folders = new Set([...docFiles.length ? ["docs/"] : [], ...docFiles.map(file => file.slice(0, file.lastIndexOf("/") + 1))]);
  for (const folder of [...folders].filter(folder => folder !== "docs/")) {
    for (let parent = folder.slice(0, folder.slice(0, -1).lastIndexOf("/") + 1); parent.length > "docs/".length; parent = parent.slice(0, parent.slice(0, -1).lastIndexOf("/") + 1)) folders.add(parent);
  }
  for (const folder of folders) {
    const index = `${folder}README.md`;
    if (!existsSync(resolve(root, index))) { fail(folder.slice(0, -1), 1, `Folder has no README.md index`); continue; }
    const linked = new Set(load(resolve(root, index)).links.map(({ href }) => {
      try { return relative(root, resolve(root, "." + decodeURIComponent(new URL(href, `https://docs.invalid/${index}`).pathname))).split(sep).join("/"); } catch { return ""; }
    }));
    const children = [...docFiles.filter(file => file.startsWith(folder) && !file.slice(folder.length).includes("/") && file !== index),
      ...[...folders].filter(other => other !== folder && other.startsWith(folder) && !other.slice(folder.length, -1).includes("/")).map(other => `${other}README.md`)];
    for (const child of children) if (!linked.has(child)) fail(index, 1, `Index does not link ${child}`);
  }

  // Code, scripts and workflows that name a doc must name one that exists (applied migrations are immutable, so skipped).
  const codeFiles = [...CODE_DIRS.flatMap(dir => walk(resolve(root, dir))), ...CODE_FILES.map(file => resolve(root, file)).filter(existsSync)]
    .filter(path => !/\.test\.[cm]?[jt]sx?$/.test(path) && !path.includes(`${sep}.github${sep}skills${sep}`) && !path.includes(`${sep}db${sep}migrations${sep}`) && path !== fileURLToPath(import.meta.url) && !/\.(?:png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$/i.test(path));
  for (const path of codeFiles) {
    const file = relative(root, path).split(sep).join("/");
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/(?<![\w./-])docs\/[A-Za-z0-9_./-]+?\.md\b/g)) {
      if (!existsSync(resolve(root, match[0]))) fail(file, text.slice(0, match.index).split("\n").length, `Names a missing doc: ${match[0]}`);
    }
  }

  const apiText = apiPages.map(textOf).join("\n");
  const coverage = {
    routesNotMentioned: source.routes.filter(route => !apiText.includes(route.path)).map(route => route.path),
    environmentNotMentioned: source.environment.filter(name => !configText.includes(name)),
    migrationsNotMentioned: source.migrations.filter(file => !dataText.includes(file.split("/").at(-1))),
  };
  return { root, inventory, checked, diagnostics, source, coverage, errors: diagnostics.filter(item => item.severity === "error").length, warnings: diagnostics.filter(item => item.severity === "warning").length };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  let all = false;
  let json = false;
  let stamp = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--root" && args[index + 1]) root = resolve(args[++index]);
    else if (args[index] === "--all") all = true;
    else if (args[index] === "--json") json = true;
    else if (args[index] === "--stamp") stamp = true;
    else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else files.push(args[index]);
  }
  if (stamp) for (const file of files.map(file => relative(root, resolve(root, file)).split(sep).join("/")).filter(isHindiMirror)) stampMirror(resolve(root, file));
  const result = checkDocumentation(root, { files, all });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of result.diagnostics) console.log(`${item.severity.toUpperCase()} ${item.file}:${item.line} ${item.message}`);
    console.log(`${result.checked.length} documents checked: ${result.errors} errors, ${result.warnings} warnings.`);
    console.log(`Source inventory: ${result.source.commands.length} commands, ${result.source.routes.length} API routes, ${result.source.environment.length} environment keys, ${result.source.migrations.length} migrations.`);
    console.log(`Mention coverage gaps (not contract validation): ${result.coverage.routesNotMentioned.length} routes, ${result.coverage.environmentNotMentioned.length} environment keys, ${result.coverage.migrationsNotMentioned.length} migrations. Use --json for details.`);
  }
  process.exitCode = result.errors ? 1 : 0;
}