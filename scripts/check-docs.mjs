import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";
import { parse as parseHtml } from "node-html-parser";
import ts from "typescript";

const markdown = new MarkdownIt({ html: true });
const historicalNames = new Set([
  "PRODUCT-AUDIT-2026-09.md", "how-we-got-here.md", "ORCHESTRATION-HISTORY-2026-09-26.md",
  "RELEASE-2026-09-06.md", "CREATIVE-GENERATION-PLAN.md", "META-INSTANT-CONNECT-PLAN.md",
  "PRODUCT-DESIGN-ROADMAP.md",
]);
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
    file.startsWith("docs/meta-connect-workers/") || historicalNames.has(file.split("/").at(-1)) ||
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
      if (token.children) inspect(token.children, line);
    }
  };
  inspect(tokens);
  return { text, anchors, links, examples, unclosedFences };
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

export function checkDocumentation(root, options = {}) {
  root = resolve(root);
  const files = [...(existsSync(resolve(root, "README.md")) ? [resolve(root, "README.md")] : []), ...walk(resolve(root, "docs")).filter(file => file.endsWith(".md"))];
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
  const apiText = textOf("docs/API_REFERENCE.md");
  const configText = textOf("docs/CONFIGURATION.md");
  const dataText = textOf("docs/DATA_MODEL.md");
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
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--root" && args[index + 1]) root = resolve(args[++index]);
    else if (args[index] === "--all") all = true;
    else if (args[index] === "--json") json = true;
    else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else files.push(args[index]);
  }
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