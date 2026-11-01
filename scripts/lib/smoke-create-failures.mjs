/**
 * #2504: why a Create run saved fewer ads than it asked for. Every create-mode FAIL only said `Create saved 2/3 ads`
 * because Chrome dropped the stream body before Playwright read it, so the smoke tees the stream in the page and
 * reads the run's failed attempts (`llm_usage_events`, owner RLS) by generation id.
 */

/**
 * The Create NDJSON stream: the final `result` event and the ads that arrived on the way.
 * @param {string} text
 * @returns {{ result: { status: number, body: any } | null, streamed: number }}
 */
export function parseCreateStream(text) {
  let result = null;
  let streamed = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === "creative") streamed++;
    if (event?.type === "result") result = { status: event.status, body: event.body };
  }
  return { result, streamed };
}

/** One failed attempt, as a short reason code: `LLM_RATE_LIMIT`, `CreativeValidationError[too-long,no-subject]`. */
function reasonCode(row) {
  const rules = Array.isArray(row.metadata?.validationRules) ? row.metadata.validationRules : [];
  const stage = row.metadata?.validationStage;
  const code = row.error_code ?? row.metadata?.failure ?? "unknown";
  return `${row.usage_kind === "image" ? "picture " : ""}${code}${rules.length ? `[${rules.join(",")}]` : stage ? `[${stage}]` : ""}`;
}

/**
 * NOTE lines for a short run: one per missing ad (from the result's `failures`), then the failed attempts by
 * reason, provider and model. The create-smoke alert copies every NOTE line.
 * @param {{ expected: number, saved: number | null, failures?: { angle?: string, error?: string }[] | null,
 *   usage?: { usage_kind?: string, provider?: string, model?: string, error_code?: string | null, metadata?: any }[] | null }} run
 * @returns {string[]}
 */
export function createFailureLines({ expected, saved, failures, usage }) {
  const lines = [];
  const missing = saved == null ? null : Math.max(0, expected - saved);
  if (missing === 0) return lines;
  const listed = Array.isArray(failures) ? failures : [];
  for (const failure of listed) {
    lines.push(`NOTE missing ad "${String(failure.angle ?? "unnamed").slice(0, 60)}": ${String(failure.error ?? "no reason given").split("\n")[0].slice(0, 160)}`);
  }
  if (missing && listed.length < missing) {
    lines.push(`NOTE ${missing - listed.length} missing ad${missing - listed.length === 1 ? "" : "s"} not named by Create (the run's result was not read)`);
  }
  const rows = (usage ?? []).filter((row) => row && (row.status ?? "error") === "error");
  if (usage == null) lines.push("NOTE failed attempts: not read");
  else if (!rows.length) lines.push("NOTE failed attempts: none recorded for this run");
  else {
    const counts = new Map();
    for (const row of rows) {
      const key = `${reasonCode(row)} (${row.provider ?? "?"}/${row.model ?? "?"})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    lines.push(`NOTE failed attempts: ${[...counts].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}× ${key}`).join("; ")}`);
  }
  return lines;
}
