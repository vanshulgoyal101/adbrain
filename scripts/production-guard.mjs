// Production checks for .github/workflows/production-guard.yml. Needs VERCEL_TOKEN.
//   live                      print the commit the production domain serves
//   wait <sha>                wait up to 5 minutes for production to serve <sha>
//   drift <sha> <epochSecs>   wait until 15 minutes after main HEAD <sha> landed; fail if it is not live
//   rollback <badSha> [id]    roll back only while production still serves the failed deployment
//   served <sha>              no token: wait up to 6 min for the domain's X-AdBrain-Release to be <sha> (#1457)
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const team = "vanshul-goyals-projects";
const domain = "adbrain.vanshul.com";
const token = process.env.VERCEL_TOKEN;

/** Strips the token and anything shaped like a Vercel token from text bound for logs or issues. */
function redact(text) {
  return (token ? text.split(token).join("[token]") : text).replace(/\b(vc[a-z])_[A-Za-z0-9]{16,}/g, "$1_[redacted]");
}

async function vercel(path) {
  if (!token) throw new Error("VERCEL_TOKEN is not set.");
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("slug", team);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // Vercel's error code and message name the cause (expired token, missing scope, rate limit); no secrets.
    const error = (await response.json().catch(() => null))?.error;
    throw new Error(`Vercel API ${url.pathname}: HTTP ${response.status}${error ? ` ${error.code ?? ""}: ${String(error.message ?? "").slice(0, 200)}` : ""}`);
  }
  return response.json();
}

const live = async () => {
  const deployment = await vercel(`/v13/deployments/${domain}`);
  return { id: deployment.id, url: deployment.url, sha: deployment.meta?.githubCommitSha ?? "unknown", created: deployment.createdAt };
};

const mainHead = async () => {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const headers = { Accept: "application/vnd.github.sha" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers });
  return response.ok ? (await response.text()).trim() : null;
};

const [command, sha, landed] = process.argv.slice(2);
if (command === "live") {
  console.log(JSON.stringify(await live()));
} else if (command === "wait") {
  const { deployments } = await vercel("/v6/deployments?app=adbrain&target=production&state=READY&limit=20");
  const ours = deployments.find((deployment) => deployment.meta?.githubCommitSha === sha);
  for (let i = 0; ; i++) {
    const current = await live();
    if (current.sha === sha) { console.log(`Production serves ${sha.slice(0, 7)}`); break; }
    if (ours && current.created > ours.created) {
      // The newer deployment's own run smokes production.
      console.log(`Superseded: production serves newer ${current.sha.slice(0, 7)}; skipping smoke for ${sha.slice(0, 7)}`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "superseded=true\n");
      break;
    }
    if (i >= 20) throw new Error(`Production still serves ${current.sha.slice(0, 7)}, not ${sha.slice(0, 7)}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
} else if (command === "drift") {
  const deadline = (Number(landed) + 15 * 60) * 1000;
  let current = await live();
  while (current.sha !== sha && Date.now() < deadline) {
    const head = await mainHead();
    if (head && head !== sha) {
      console.log(`main moved on to ${head.slice(0, 7)}; that commit's run checks production`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    current = await live();
  }
  const minutes = Math.round((Date.now() / 1000 - Number(landed)) / 60);
  if (current.sha === sha) console.log(`OK: production serves main HEAD ${sha.slice(0, 7)} (${minutes} min after it landed)`);
  else {
    console.log(`DRIFT: main HEAD ${sha.slice(0, 7)} landed ${minutes} min ago but production serves ${current.sha.slice(0, 7)} (${current.url})`);
    process.exitCode = 1;
  }
} else if (command === "served") {
  // #1457: a hand rollback/promote can pin the domain to an old deployment; then the smoke would test the wrong
  // build. The app sends its build's commit as X-AdBrain-Release, so this needs no Vercel token.
  const repo = process.env.GITHUB_REPOSITORY;
  const newer = async (served) => {
    if (!repo) return false;
    const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
    const response = await fetch(`https://api.github.com/repos/${repo}/compare/${sha}...${served}`, { headers });
    return response.ok && (await response.json()).status === "ahead";
  };
  let served = "";
  for (let i = 0; ; i++) {
    const response = await fetch(`https://${domain}/`, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    served = response?.headers.get("x-adbrain-release") ?? "";
    if (served === sha) { console.log(`Production serves ${sha.slice(0, 7)}`); break; }
    if (served && served !== "local" && await newer(served)) {
      console.log(`Superseded: production serves newer ${served.slice(0, 7)}; its own run smokes it`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "superseded=true\n");
      break;
    }
    if (i >= 24) {
      console.log(`FAIL Domain serves ${served ? served.slice(0, 7) : "an unknown build"}, not ${sha.slice(0, 7)}: promote the newest production deployment (docs/operations/releasing-recovery.md#rollback-and-incident-handling)`);
      process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
} else if (command === "rollback") {
  async function rollback() {
    const expectedId = process.argv[4];
    if (!sha || sha === "unknown") throw new Error("Rollback refused: failed commit is unknown");
    const current = await live();
    const known = (deployment) => deployment.id && deployment.sha && deployment.sha !== "unknown";
    if (!known(current)) throw new Error("Rollback refused: production deployment identity is unknown");
    if (current.sha !== sha || (expectedId && current.id !== expectedId)) {
      console.log(`Superseded: rollback skipped for ${sha.slice(0, 7)}; production serves a different deployment (${current.id}, ${current.sha.slice(0, 7)})`);
      return;
    }
    const { deployments } = await vercel("/v6/deployments?app=adbrain&target=production&state=READY&limit=20");
    const bad = deployments.find((deployment) => deployment.uid === current.id && deployment.meta?.githubCommitSha === sha);
    if (!bad || !Number.isFinite(bad.created)) throw new Error(`Rollback refused: failed deployment ${current.id} is missing from READY production history`);
    const target = deployments.find((deployment) => deployment.created < bad.created && deployment.meta?.githubCommitSha !== sha);
    if (!target) throw new Error(`No earlier READY production deployment to roll back to from ${sha.slice(0, 7)}`);
    // The smoke and history lookup can race a new deployment; check again at the CLI mutation boundary.
    const latest = await live();
    if (!known(latest)) throw new Error("Rollback refused: production deployment identity is unknown at promotion");
    if (latest.id !== current.id || latest.sha !== sha) {
      console.log(`Superseded: rollback skipped for ${sha.slice(0, 7)}; production changed to ${latest.id} (${latest.sha.slice(0, 7)}) before promotion`);
      return;
    }
    console.log(`Rolling back ${current.sha.slice(0, 7)} -> ${target.meta?.githubCommitSha?.slice(0, 7)} (${target.url})`);
    // Promote, not `vercel rollback`: a rollback turns off auto-assignment and holds every later
    // deploy until someone promotes by hand (#316, #390). The next push still gets its own guard.
    // The CLI reads VERCEL_TOKEN from the environment. Never pass it as an argument: a failed
    // command's error repeats its arguments, and this output is posted to a public issue (#413).
    try {
      execFileSync("npx", ["--yes", "vercel@60.1.3", "promote", target.url, "--yes", "--scope", team], {
        stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, VERCEL_TOKEN: token },
      });
    } catch (error) {
      throw new Error(`vercel promote failed: ${redact(String(error.stderr ?? "")).trim().split("\n").at(-1)?.slice(0, 300) ?? "no output"}`);
    }
    const after = await live();
    console.log(`Production now serves ${after.sha.slice(0, 7)} (${after.url})`);
    if (after.id !== target.uid) process.exitCode = 1;
  }
  await rollback();
} else {
  throw new Error("Usage: production-guard.mjs live | wait <sha> | drift <sha> <epochSecs> | served <sha> | rollback <badSha> [deploymentId]");
}
