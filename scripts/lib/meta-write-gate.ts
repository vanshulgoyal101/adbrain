// #1324: Meta recorders write to a real ad account (validate_only checks, PAUSED parents deleted after).
// Imported first by every scripts/record-meta-*.ts: a non-GET Graph call needs ADBRAIN_ALLOW_META_WRITES=1
// in the shell, so a headless or automated run can't write by accident; a person sets it on purpose.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.hostname === "graph.facebook.com" && method !== "GET") {
    // #1513: a headless supervisor run can set the flag itself, so it never writes.
    if (process.env.ADBRAIN_HEADLESS === "1") throw new Error(`Refusing ${method} ${url.pathname}: Meta writes are refused in a headless supervisor run.`);
    if (process.env.ADBRAIN_ALLOW_META_WRITES !== "1") {
      throw new Error(`Refusing ${method} ${url.pathname}: set ADBRAIN_ALLOW_META_WRITES=1 to let this recorder write to Meta.`);
    }
  }
  return realFetch(input, init);
};

export {};
