import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dockerEnv = { ...process.env, DOCKER_HOST: `unix://${process.env.HOME}/.colima/adbrain-qa/docker.sock` };
const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", root, "-o", "json"], { env: dockerEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
for (const key of ["API_URL", "DB_URL"]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(local[key]).hostname), "Only loopback Supabase is permitted.");
const derive = label => createHmac("sha256", local.SERVICE_ROLE_KEY).update(`adbrain-local-qa:${label}`).digest("base64");
const inherited = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const env = { ...process.env, ...Object.fromEntries(Object.keys(inherited).map(key => [key, ""])) };
Object.assign(env, {
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL: "http://localhost:3939",
  NEXT_PUBLIC_DEV_AUTH_BYPASS: "", DEV_LOGIN_EMAIL: "meta-qa@example.test", DEV_LOGIN_PASSWORD: derive("password"),
  DEMO_USER_EMAIL: "demo@example.test", TRAFFIC_GENERATOR_MAX_ROUNDS: "1",
  CREATIVE_MAX_TOKENS: "6000", CREATIVE_REASONING_EFFORT: "medium",
  META_TOKEN_ENCRYPTION_KEY: derive("encryption"),
  META_APP_ID: "local-qa-not-a-meta-app", META_APP_SECRET: "local-qa-not-a-meta-secret", META_LOGIN_CONFIG_ID: "", META_SYSTEM_USER_TOKEN: "", META_AD_ACCOUNT_ID: "", META_PAGE_ID: "",
  GOOGLE_AI_API_KEYS: "", GROQ_API_KEYS: "", OPENROUTER_API_KEYS: "", CEREBRAS_API_KEYS: "", FALAI_API_KEY: "", OPENAI_API_KEY: "",
  CRON_SECRET: "", IMAGE_PROVIDER: "none", IMAGE_PROVIDER_FALLBACK: "none",
  WORKSPACE_CHECK_URL: "http://localhost:3939", META_CONNECT_UI_BASE_URL: "http://localhost:3939",
});
const mode = process.argv[2];
if (mode === "oauth-dev") {
  assert.ok(inherited.META_APP_ID && inherited.META_APP_SECRET, "Existing Meta app credentials required.");
  env.META_APP_ID = inherited.META_APP_ID;
  env.META_APP_SECRET = inherited.META_APP_SECRET;
  env.META_LOGIN_CONFIG_ID = inherited.META_LOGIN_CONFIG_ID ?? "";
}
if (mode === "setup") {
  const database = new pg.Client({ connectionString: local.DB_URL });
  await database.connect();
  try {
    await database.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: users, error: listError } = await admin.auth.admin.listUsers();
    if (listError) throw new Error("Local Auth user lookup failed.");
    let user = users.users.find(candidate => candidate.email === env.DEV_LOGIN_EMAIL);
    if (!user) {
      const created = await admin.auth.admin.createUser({ email: env.DEV_LOGIN_EMAIL, password: env.DEV_LOGIN_PASSWORD, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Local Auth fixture creation failed.");
      user = created.data.user;
    }
    const businessId = "11111111-1111-4111-8111-111111111111";
    await database.query("insert into public.businesses (id,owner_id,name,vertical,description,locations) values ($1,$2,'QA Solar','solar','Local synthetic review fixture',ARRAY['Bengaluru']) on conflict (id) do nothing", [businessId, user.id]);
    for (const [index, headline] of ["Review your rooftop", "Plan your solar installation"].entries()) {
      await database.query("insert into public.creatives (id,business_id,brief,angle,image_url,headline,primary_text,cta,status) values ($1,$2,'Rooftop assessment','Value','/solar-example.jpg',$3,'Book a local rooftop assessment.','Book Now','draft') on conflict (id) do nothing", [`55555555-5555-4555-8555-55555555555${index}`, businessId, headline]);
    }
    await database.query("notify pgrst, 'reload schema'");
    console.log("Local schema and synthetic Auth/business/creative fixtures ready. No remote services modified.");
  } finally { await database.end(); }
} else {
  const commands = {
    dev: ["npm", ["run", "dev", "--", "--port", "3939"]],
    "oauth-dev": ["npm", ["run", "dev", "--", "--port", "3939"]],
    "oauth-check": ["node", ["scripts/check-meta-oauth-entry.mjs"]],
    build: ["npm", ["run", "build"]],
    workspace: ["node", ["scripts/check-workspace-ux.mjs"]],
    connect: ["node", ["scripts/check-meta-connect-ui.mjs"]],
    e2e: ["npx", ["playwright", "test", "e2e/workspace.spec.ts", "--workers=1"]],
    recovery: ["npx", ["playwright", "test", "e2e/campaign-recovery.spec.ts", "--workers=1"]],
    "draft-connect": ["npx", ["playwright", "test", "e2e/draft-connect.spec.ts", "--workers=1"]],
    "connection-recovery": ["npx", ["playwright", "test", "e2e/meta-recovery.spec.ts", "e2e/draft-connect.spec.ts", "e2e/campaign-recovery.spec.ts", "--workers=1"]],
  };
  assert.ok(commands[mode], "Choose setup, dev, oauth-dev, oauth-check, build, workspace, connect, e2e, recovery, draft-connect, or connection-recovery.");
  const [command, args] = commands[mode];
  const child = spawn(command, args, { cwd: root, env, stdio: mode === "oauth-dev" ? ["inherit", "pipe", "pipe"] : "inherit" });
  if (mode === "oauth-dev") {
    const redact = chunk => {
      let text = chunk.toString().replace(/([?&](?:code|state|access_token|appsecret_proof)=)[^&\s]+/g, "$1[redacted]");
      for (const value of [env.META_APP_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.META_TOKEN_ENCRYPTION_KEY, env.DEV_LOGIN_PASSWORD]) {
        if (value) text = text.replaceAll(value, "[redacted]");
      }
      return text;
    };
    child.stdout.on("data", chunk => process.stdout.write(redact(chunk)));
    child.stderr.on("data", chunk => process.stderr.write(redact(chunk)));
  }
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("exit", code => { process.exitCode = code ?? 1; });
}