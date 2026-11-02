/**
 * ADR-001 (#1792) Phase 1 boundary rules, as specified by the Reviewer (#1815, on #1792).
 * CI runs `npm run boundaries`; known violations live in `scripts/boundaries-baseline.json`, which may only
 * shrink (scripts/check-boundaries.mjs enforces that).
 */
import fs from "node:fs";
import path from "node:path";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Files that start with a "use client" directive (R2); read at load time so no pre-step is needed. */
function clientFiles(dir = "src") {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...clientFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      const head = fs.readFileSync(full, "utf8").slice(0, 200).replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
      if (/^["']use client["']/.test(head)) found.push(full.split(path.sep).join("/"));
    }
  }
  return found;
}

const clients = clientFiles();
const UI = "^src/(components|app)/";
const META_TYPES = "^src/lib/meta/(types|contracts|connect-contracts)\\.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  forbidden: [
    {
      name: "R1-ui-no-channels",
      comment: "Routes and components reach channels through services, never channels/* or lib/meta directly.",
      severity: "error",
      from: { path: UI },
      to: { path: "^src/(channels/|lib/meta/)", pathNot: META_TYPES },
    },
    {
      name: "R1-ui-meta-types-only",
      comment: "UI may keep type-only imports of the Meta contract types until the domain types exist.",
      severity: "error",
      from: { path: UI },
      to: { path: META_TYPES, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "R2-client-no-server",
      comment: "A \"use client\" file must not value-import server modules (they would ship to the browser). Type-only imports are erased.",
      severity: "error",
      from: { path: clients.length ? `^(${clients.map(escape).join("|")})$` : "^$" },
      to: { path: "^src/lib/(supabase/admin|meta/|payments/|llm/)|^(node:)?crypto$", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "R3-domain-no-app-imports",
      comment: "src/domain is pure: it imports only itself.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/", pathNot: "^src/domain/" },
    },
    {
      name: "R3-domain-npm-only-zod",
      comment: "src/domain may use zod and nothing else from npm.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-no-pkg", "npm-unknown"], pathNot: "node_modules/zod/" },
    },
    {
      name: "R3-domain-no-io",
      comment: "src/domain does no I/O.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { dependencyTypes: ["core"], path: "^(node:)?(fs|net|http|https|http2|child_process|dgram|tls)(/|$)" },
    },
    {
      name: "R4-services-via-registry",
      comment: "Services reach adapters only through channels/registry.",
      severity: "error",
      from: { path: "^src/services/" },
      to: { path: "^src/channels/", pathNot: "^src/channels/registry\\." },
    },
    {
      name: "R5-channel-isolation",
      comment: "No adapter imports another adapter.",
      severity: "error",
      from: { path: "^src/channels/([^/]+)/" },
      to: { path: "^src/channels/[^/]+/", pathNot: "^src/channels/$1/" },
    },
    {
      name: "R6-money-not-in-adapters",
      comment: "Adapters never decide money; payments, plan and the managed spend-cap gate live in services.",
      severity: "error",
      from: { path: "^src/(channels|lib/meta)/" },
      to: { path: "^src/lib/(payments|plan|managed/spend-cap)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.(test|spec)\\.[jt]sx?$" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
    skipAnalysisNotInRules: true,
  },
};

export default config;
