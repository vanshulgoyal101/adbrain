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
 * NOTE lines for a short run: one per missing ad, its own failed attempts, then the run's attempts by reason.
 * The create-smoke alert copies every NOTE line.
 * @param {{ expected: number, saved: number | null, failures?: { angle?: string, angleId?: string, code?: string, error?: string }[] | null,
 *   usage?: { usage_kind?: string, provider?: string, model?: string, status?: string, error_code?: string | null,
 *     metadata?: { angle?: string, failure?: string, validationRules?: string[], validationStage?: string } | null }[] | null }} run
 * @returns {string[]}
 */
export function createFailureLines({ expected, saved, failures, usage }) {
  const lines = [];
  const missing = saved == null ? null : Math.max(0, expected - saved);
  if (missing === 0) return lines;
  const rows = (usage ?? []).filter((row) => row && (row.status ?? "error") === "error");
  const formatAttempts = (attempts) => {
    const counts = new Map();
    for (const row of attempts) {
      const key = `${reasonCode(row)} (${row.provider ?? "?"}/${row.model ?? "?"})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}× ${key}`).join("; ");
  };
  const listed = Array.isArray(failures) ? failures : [];
  for (const failure of listed) {
    const angle = String(failure.angle ?? "unnamed").slice(0, 60);
    const attempts = failure.angleId ? rows.filter((row) => row.metadata?.angle === failure.angleId) : [];
    const error = String(failure.error ?? "").split("\n")[0].slice(0, 160);
    const reason = failure.angleId
      ? formatAttempts(attempts) || failure.code || error || "no per-ad cause recorded"
      : error || "no reason given";
    lines.push(`NOTE missing ad "${angle}": ${reason}`);
  }
  if (missing && listed.length < missing) {
    lines.push(`NOTE ${missing - listed.length} missing ad${missing - listed.length === 1 ? "" : "s"} not named by Create (the run's result was not read)`);
  }
  if (usage == null) lines.push("NOTE failed attempts: not read");
  else if (!rows.length) lines.push("NOTE failed attempts: none recorded for this run");
  else lines.push(`NOTE failed attempts: ${formatAttempts(rows)}`);
  return lines;
}
