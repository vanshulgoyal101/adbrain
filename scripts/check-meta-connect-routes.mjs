import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const clientPath = join(root, "src/lib/meta-connect-ui/client.ts");
const client = readFileSync(clientPath, "utf8");

const expected = [
  ["POST", "/api/meta/connections/start", "/api/meta/connections/start", "src/app/api/meta/connections/start/route.ts"],
  ["GET", "/api/meta/connections/status", "/api/meta/connections/status", "src/app/api/meta/connections/status/route.ts"],
  ["GET", "/api/meta/connections/attempts/[id]", "/api/meta/connections/attempts/${", "src/app/api/meta/connections/attempts/[id]/route.ts"],
  ["POST", "/api/meta/connections/attempts/[id]/select", "/api/meta/connections/attempts/${", "src/app/api/meta/connections/attempts/[id]/select/route.ts"],
  ["POST", "/api/meta/connections/attempts/[id]/retry", "/api/meta/connections/attempts/${", "src/app/api/meta/connections/attempts/[id]/retry/route.ts"],
  ["POST", "/api/campaign-drafts", "/api/campaign-drafts", "src/app/api/campaign-drafts/route.ts"],
  ["PUT", "/api/campaign-drafts/[id]", "/api/campaign-drafts/${", "src/app/api/campaign-drafts/[id]/route.ts"],
  ["POST", "/api/campaigns/preflight", "/api/campaigns/preflight", "src/app/api/campaigns/preflight/route.ts"],
  ["POST", "/api/campaigns/create", "/api/campaigns/create", "src/app/api/campaigns/create/route.ts"],
  ["GET", "/api/campaigns/operations/[id]", "/api/campaigns/operations/${", "src/app/api/campaigns/operations/[id]/route.ts"],
];

const missing = expected.filter((entry) => {
  const [, , clientFragment, file] = entry;
  return !client.includes(clientFragment) || !existsSync(join(root, file));
});

if (missing.length) {
  for (const [method, route, , file] of missing) {
    console.error(`${method} ${route}: missing handler or client contract (${file})`);
  }
  process.exit(1);
}

console.log(`Meta/campaign client route inventory: PASS (${expected.length} routes)`);