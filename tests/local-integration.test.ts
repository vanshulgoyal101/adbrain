import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isolatedFetch, verifyDockerHost, verifyTarget } from "../scripts/check-local-integration.mjs";
import { verifyManifest, verifySource } from "../scripts/prepare-qa-source.mjs";

describe("QA source identity", () => {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const head = "a".repeat(40);
  const makeManifest = (file = "source.txt") => {
    const files = [{ file, sha256: digest("fixture") }];
    return { head, files, hash: digest(JSON.stringify(files)) };
  };

  it("checks the expected head, manifest digest and safe source paths", () => {
    const manifest = makeManifest();
    expect(verifyManifest(manifest, head, manifest.hash)).toBe(manifest);
    expect(() => verifyManifest(manifest, "b".repeat(40), manifest.hash)).toThrow();
    expect(() => verifyManifest({ ...manifest, files: [] }, head, manifest.hash)).toThrow();
    for (const file of ["../outside", "/absolute", ".env.local", "nested/.env", "node_modules/file", "src/../outside"]) {
      const unsafe = makeManifest(file);
      expect(() => verifyManifest(unsafe, head, unsafe.hash)).toThrow();
    }
  });

  it("rejects changed, additional or symlinked reconstructed files", () => {
    const root = mkdtempSync(join(tmpdir(), "adbrain-ops-manifest-test-"));
    const manifest = makeManifest();
    try {
      writeFileSync(join(root, "source.txt"), "fixture");
      expect(verifySource(root, manifest)).toBe(1);
      writeFileSync(join(root, "source.txt"), "changed");
      expect(() => verifySource(root, manifest)).toThrow();
      writeFileSync(join(root, "source.txt"), "fixture");
      writeFileSync(join(root, "extra.txt"), "extra");
      expect(() => verifySource(root, manifest)).toThrow();
      rmSync(join(root, "extra.txt"));
      rmSync(join(root, "source.txt"));
      symlinkSync("missing", join(root, "source.txt"));
      expect(() => verifySource(root, manifest)).toThrow("Symlink refused");
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

describe("local integration isolation", () => {
  it("preloads unit transport blocking for providers and other local services", () => {
    const guard = fileURLToPath(new URL("../scripts/qa-unit-network-guard.mjs", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", guard, "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { get } from "node:http";
      import https from "node:https";
      import net from "node:net";
      import tls from "node:tls";
      import dgram from "node:dgram";
      await assert.rejects(fetch("https://graph.facebook.com/test"), /QA_UNIT_NETWORK_BLOCKED/);
      await assert.rejects(fetch("http://localhost:3939"), /QA_UNIT_NETWORK_BLOCKED/);
      for (const request of [
        () => get("http://127.0.0.1:56321"),
        () => https.request("https://example.com"),
        () => net.connect(56322, "127.0.0.1"),
        () => new net.Socket().connect(443, "example.com"),
        () => tls.connect(443, "example.com"),
        () => dgram.createSocket("udp4"),
      ]) assert.throws(request, /QA_UNIT_NETWORK_BLOCKED/);
    `], { encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" } });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts a CI Unix socket but refuses remote Docker endpoints", () => {
    expect(verifyDockerHost("unix:///var/run/docker.sock")).toBe("unix:///var/run/docker.sock");
    expect(() => verifyDockerHost("tcp://production.example:2376")).toThrow();
    expect(() => verifyDockerHost("unix://production.example/var/run/docker.sock")).toThrow();
    expect(() => verifyDockerHost("unix:///var/run/docker.sock?host=other")).toThrow();
  });

  it("blocks external origins and redirects before provider access", async () => {
    const transport = vi.fn(async () => new Response("ok"));
    const request = isolatedFetch("http://127.0.0.1:55321", transport);
    await expect(request("https://graph.facebook.com/test")).rejects.toThrow("blocked");
    await expect(request("http://127.0.0.1:55322/rest/v1/test")).rejects.toThrow("blocked");
    await expect(request("http://127.0.0.1:55321/api/campaigns/create")).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await request("http://127.0.0.1:55321/rest/v1/businesses");
    expect(transport).toHaveBeenCalledWith("http://127.0.0.1:55321/rest/v1/businesses", { redirect: "error" });
  });

  it("requires the expected local Docker database and gateway, not just localhost", () => {
    const local = { API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:fixture@127.0.0.1:55322/postgres", ANON_KEY: "fixture", SERVICE_ROLE_KEY: "fixture" };
    const containers = [
      { Name: "/supabase_db_adbrain-ops-test", State: { Running: true }, Config: { Image: "public.ecr.aws/supabase/postgres:17" }, NetworkSettings: { Ports: { "5432/tcp": [{ HostPort: "55322" }] } } },
      { Name: "/supabase_kong_adbrain-ops-test", State: { Running: true }, Config: { Image: "public.ecr.aws/supabase/kong:2" }, NetworkSettings: { Ports: { "8000/tcp": [{ HostPort: "55321" }] } } },
    ];
    expect(verifyTarget(local, containers, "adbrain-ops-test")).toBe("http://127.0.0.1:55321");
    expect(() => verifyTarget(local, [], "adbrain-ops-test")).toThrow();
    expect(() => verifyTarget({ ...local, DB_URL: "postgresql://postgres@production.example/postgres" }, containers, "adbrain-ops-test")).toThrow();
    expect(() => verifyTarget(local, containers, "adbrain")).toThrow();
    expect(() => verifyTarget({ ...local, API_URL: "http://127.0.0.1:3939" }, containers, "adbrain-ops-test")).toThrow();
  });
});