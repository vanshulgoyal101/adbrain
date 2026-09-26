import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

export function verifyDockerHost(host) {
  const url = new URL(host);
  assert.equal(url.protocol, "unix:", "Only a local Unix Docker socket is allowed");
  assert.equal(url.hostname + url.username + url.password + url.search + url.hash, "");
  assert.ok(url.pathname.startsWith("/") && url.pathname.endsWith(".sock"), "An absolute Docker socket path is required");
  return host;
}

export function verifyTarget(local, containers, project) {
  assert.match(project, /^adbrain-(?:independent-qa|ops|ci)-[a-z0-9-]+$/);
  const api = new URL(local.API_URL);
  const database = new URL(local.DB_URL);
  for (const url of [api, database]) assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Non-loopback target refused");
  assert.equal(api.protocol, "http:");
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(api.username + api.password, "");
  for (const [service, port, url, image] of [
    ["db", "5432/tcp", database, "/supabase/postgres:"],
    ["kong", "8000/tcp", api, "/supabase/kong:"],
  ]) {
    const container = containers.find(candidate => candidate.Name === `/supabase_${service}_${project}`);
    assert.ok(container?.State.Running && container.Config.Image.includes(image), "Expected local Supabase container missing");
    assert.ok(container.NetworkSettings.Ports[port]?.some(binding => binding.HostPort === url.port), "Published port does not match local status");
  }
  assert.ok(local.ANON_KEY && local.SERVICE_ROLE_KEY, "Local credentials missing");
  return api.origin;
}

export function isolatedFetch(origin, transport = fetch) {
  return async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, origin, "External provider/network request blocked");
    assert.match(url.pathname, /^\/(auth|rest|storage)\/v1(?:\/|$)/);
    return transport(input, { ...options, redirect: "error" });
  };
}

async function run() {
  const { values } = parseArgs({ options: {
    workdir: { type: "string" }, project: { type: "string" }, "confirm-synthetic": { type: "boolean", default: false },
    "docker-host": { type: "string" },
  } });
  assert.ok(values.workdir && values.project && values["confirm-synthetic"], "Explicit isolated workdir/project and --confirm-synthetic required");
  const dockerHost = verifyDockerHost(values["docker-host"] ?? `unix://${process.env.HOME}/.colima/adbrain-qa/docker.sock`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: "/tmp", DOCKER_HOST: dockerHost };
  const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", resolve(values.workdir), "-o", "json"], {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
  const containers = JSON.parse(execFileSync("docker", ["--host", dockerHost, "inspect",
    `supabase_db_${values.project}`, `supabase_kong_${values.project}`], {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
  const origin = verifyTarget(local, containers, values.project);
  const guardedFetch = isolatedFetch(origin);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(origin, local.SERVICE_ROLE_KEY, options);
  const anonymous = createClient(origin, local.ANON_KEY, options);
  const runId = randomUUID();
  const users = [];
  const businesses = [];
  const paths = [];
  const checks = [];
  let cleanupFailed = false;
  try {
    await assert.rejects(guardedFetch("https://graph.facebook.com/ops-probe"), /blocked/);
    checks.push("external transport blocked before network");
    for (const label of ["owner", "other"]) {
      const email = `ops-${label}-${runId}@example.test`;
      const password = randomBytes(32).toString("base64url");
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.ok(!created.error && created.data.user, "Synthetic Auth fixture creation failed");
      users.push(created.data.user.id);
      const client = createClient(origin, local.ANON_KEY, options);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      assert.ok(!signedIn.error && signedIn.data.session, "Synthetic password sign-in failed");
      const id = randomUUID();
      businesses.push({ id, client });
      const inserted = await admin.from("businesses").insert({ id, owner_id: created.data.user.id, name: "OPS synthetic isolation probe", vertical: "test" });
      assert.equal(inserted.error, null, "Synthetic business insert failed");
    }
    checks.push("real Auth creation and sign-in for two synthetic owners");
    const [owner, other] = businesses;
    const read = await owner.client.from("businesses").select("id").in("id", businesses.map(item => item.id));
    assert.equal(read.error, null, "Owner REST read failed");
    assert.deepEqual(read.data, [{ id: owner.id }], "REST tenant isolation failed");
    const anonRead = await anonymous.from("businesses").select("id").eq("id", owner.id);
    assert.ok(anonRead.error?.code === "42501" || (!anonRead.error && anonRead.data.length === 0), "Anonymous business access was not denied");
    checks.push("real PostgREST owner/wrong-tenant/anonymous isolation");
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64");
    const ownedPath = `${owner.id}/ops-${runId}.png`;
    const foreignPath = `${other.id}/ops-${runId}.png`;
    paths.push(ownedPath, foreignPath);
    const uploaded = await owner.client.storage.from("brand-assets").upload(ownedPath, image, { contentType: "image/png", upsert: false });
    assert.equal(uploaded.error, null, "Owned Storage upload failed");
    const forbidden = await owner.client.storage.from("brand-assets").upload(foreignPath, image, { contentType: "image/png", upsert: false });
    assert.equal(String(forbidden.error?.statusCode), "403", "Foreign Storage upload was not permission-denied");
    const publicUrl = anonymous.storage.from("brand-assets").getPublicUrl(ownedPath).data.publicUrl;
    const downloaded = await guardedFetch(publicUrl);
    assert.equal(downloaded.status, 200, "Public fixture download failed");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), image, "Stored image differs from fixture");
    checks.push("real Storage own upload, denied foreign upload, exact public image retrieval");
  } finally {
    if (paths.length) {
      const removed = await admin.storage.from("brand-assets").remove(paths).catch(() => ({ error: true }));
      if (removed.error) cleanupFailed = true;
    }
    for (const business of businesses) {
      const removed = await admin.from("businesses").delete().eq("id", business.id);
      if (removed.error) cleanupFailed = true;
      const remaining = await admin.from("businesses").select("id").eq("id", business.id);
      if (remaining.error || remaining.data?.length) cleanupFailed = true;
    }
    for (const id of users) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) cleanupFailed = true;
    }
    console.log(JSON.stringify({ project: values.project, origin, syntheticRun: runId, checks, cleanup: cleanupFailed ? "incomplete" : "completed", schemaApplied: false, providerCalls: 0 }));
    assert.equal(cleanupFailed, false, "Synthetic cleanup incomplete; retain run identity for recovery");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(() => {
    console.error("Isolated integration failed. No provider response, credentials or customer data are logged.");
    process.exitCode = 1;
  });
}