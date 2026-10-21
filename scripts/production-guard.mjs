// Production checks for .github/workflows/production-guard.yml. Needs VERCEL_TOKEN.
//   live                      print the commit the production domain serves
//   wait <sha>                wait up to 5 minutes for production to serve <sha>
//   drift <sha> <epochSecs>   fail if main HEAD <sha> is not live 15 minutes after it landed
//   rollback <badSha>         roll production back to the newest earlier READY deployment
import { execFileSync } from "node:child_process";

const team = "vanshul-goyals-projects";
const domain = "adbrain.vanshul.com";
const token = process.env.VERCEL_TOKEN;
if (!token) throw new Error("VERCEL_TOKEN is not set.");

async function vercel(path) {
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("slug", team);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Vercel API ${url.pathname}: HTTP ${response.status}`);
  return response.json();
}

const live = async () => {
  const deployment = await vercel(`/v13/deployments/${domain}`);
  return { id: deployment.id, url: deployment.url, sha: deployment.meta?.githubCommitSha ?? "unknown", created: deployment.createdAt };
};

const [command, sha, landed] = process.argv.slice(2);
if (command === "live") {
  console.log(JSON.stringify(await live()));
} else if (command === "wait") {
  for (let i = 0; ; i++) {
    const current = await live();
    if (current.sha === sha) { console.log(`Production serves ${sha.slice(0, 7)}`); break; }
    if (i >= 20) throw new Error(`Production still serves ${current.sha.slice(0, 7)}, not ${sha.slice(0, 7)}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
} else if (command === "drift") {
  const current = await live();
  const minutes = Math.round((Date.now() / 1000 - Number(landed)) / 60);
  if (current.sha === sha) console.log(`OK: production serves main HEAD ${sha.slice(0, 7)}`);
  else if (minutes < 15) console.log(`Waiting: main HEAD ${sha.slice(0, 7)} landed ${minutes} min ago; production serves ${current.sha.slice(0, 7)}`);
  else {
    console.log(`DRIFT: main HEAD ${sha.slice(0, 7)} landed ${minutes} min ago but production serves ${current.sha.slice(0, 7)} (${current.url})`);
    process.exitCode = 1;
  }
} else if (command === "rollback") {
  const current = await live();
  const { deployments } = await vercel("/v6/deployments?app=adbrain&target=production&state=READY&limit=20");
  const bad = deployments.find((deployment) => deployment.meta?.githubCommitSha === sha);
  const before = bad?.created ?? current.created;
  const target = deployments.find((deployment) => deployment.created < before && deployment.meta?.githubCommitSha !== sha);
  if (!target) throw new Error(`No earlier READY production deployment to roll back to from ${sha.slice(0, 7)}`);
  console.log(`Rolling back ${current.sha.slice(0, 7)} -> ${target.meta?.githubCommitSha?.slice(0, 7)} (${target.url})`);
  execFileSync("npx", ["--yes", "vercel@60.1.3", "rollback", target.url, "--yes", "--scope", team, "--token", token], { stdio: ["ignore", "ignore", "inherit"] });
  const after = await live();
  console.log(`Production now serves ${after.sha.slice(0, 7)} (${after.url})`);
  if (after.id !== target.uid) process.exitCode = 1;
} else {
  throw new Error("Usage: production-guard.mjs live | wait <sha> | drift <sha> <epochSecs> | rollback <badSha>");
}
