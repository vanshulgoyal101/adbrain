/**
 * #735: records Meta's real refusals for the create-cleanup core test, without creating anything:
 * an ad image upload of bytes that are not an image, and a DELETE of a campaign id that doesn't exist.
 * The campaign POST and a successful DELETE are already recorded (create.json, safety/capped-adset-delete.json).
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-cleanup-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; status: number; body: unknown };
const GRAPH = "https://graph.facebook.com/v21.0/";
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/access_token=[^&"\s]+/g, "access_token=REDACTED");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "access_token" ? "REDACTED" : scrub(item)]));
  }
  return value;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  const response = await realFetch(input, init);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  parsed.searchParams.delete("appsecret_proof");
  tape.push({ method: init?.method ?? "GET", path: parsed.pathname.replace("/v21.0/", "") + parsed.search, status: response.status,
    body: scrub(await response.clone().json().catch(() => null)) });
  return response;
};

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  await meta.uploadAdImageBytes(new TextEncoder().encode("not an image")).then(
    () => { throw new Error("Meta accepted non-image bytes; nothing to record."); },
    (error: unknown) => console.log("adimages refused:", (error as Error).message));
  const graph = (meta as unknown as { graph: (path: string, init: { method: string }) => Promise<unknown> }).graph.bind(meta);
  await graph("120000000000000000", { method: "DELETE" }).then(
    () => { throw new Error("Meta deleted a made-up id; nothing to record."); },
    (error: unknown) => console.log("delete refused:", (error as Error).message));
  globalThis.fetch = realFetch;
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/create-cleanup-refusals.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`${tape.length} exchanges`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
