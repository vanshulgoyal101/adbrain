// #1324: Meta recorders write to a real ad account (validate_only checks, PAUSED parents deleted after).
// Imported first by every scripts/record-meta-*.ts: a non-GET Graph call needs ADBRAIN_ALLOW_META_WRITES=1
// in the shell, so a headless or automated run can't write by accident; a person sets it on purpose.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.hostname === "graph.facebook.com" && method !== "GET" && process.env.ADBRAIN_ALLOW_META_WRITES !== "1") {
    throw new Error(`Refusing ${method} ${url.pathname}: set ADBRAIN_ALLOW_META_WRITES=1 to let this recorder write to Meta.`);
  }
  return realFetch(input, init);
};

export {};
