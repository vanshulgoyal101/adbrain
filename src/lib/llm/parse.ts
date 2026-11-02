/** Robustly parse JSON that may be wrapped in prose or ```json fences. */
export function parseJSON<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/[[{][\s\S]*[\]}]/)?.[0];
  for (const candidate of [cleaned, escapeRawControls(cleaned), ...(match ? [match, escapeRawControls(match)] : [])]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next repair
    }
  }
  throw new Error(`Failed to parse LLM JSON output: ${text.slice(0, 200)}`);
}

/**
 * #2444: Gemini flash-lite writes the line breaks of a multi-line field as raw newlines inside the JSON string
 * ("Bad control character in string literal"); 3 of 6 recorded concepts. Escape control characters inside strings
 * only; whitespace between tokens is valid JSON and stays.
 */
function escapeRawControls(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of json) {
    if (inString && !escaped && char < " ") {
      out += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    if (char === '"' && !escaped) inString = !inString;
    escaped = inString && !escaped && char === "\\";
    out += char;
  }
  return out;
}
