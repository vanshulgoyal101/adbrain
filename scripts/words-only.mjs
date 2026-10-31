// #364 (owner, Oct 31): a change that only rewords what an owner reads isn't a launch, Meta or money behaviour
// change, so `core-approval` lets it ship on green CI. Fail closed: anything this can't prove is words keeps the gate.
// Two independent attacks shaped it (#2428): order-preserving tokens and tree shape, an allowlist of places where
// words go, no bundler directives, and no shared wording with other source files (string matchers).

/** Words a person reads: at least two words, nothing shaped like code (braces, a pipe, a field list, a filter, a URL). */
export function prose(text) {
  const t = text.trim();
  if (!/\p{L}[\p{L}\p{M}'’-]*\s+\S*\p{L}/u.test(t)) return false;
  if (/[{}|\\]/.test(t) || /\b\w{2,}\.\w{2,}\.\w/.test(t) || /^[\w.*]+(\s*,\s*[\w.*]+)+$/.test(t)) return false;
  return !/^(https?:|\/[\w-]|[\w-]+\/[\w-])/.test(t);
}

// Calls whose string argument is shown to a person.
const SHOW = /^(toast\w*|notify\w*|alert|confirm|log|info|warn|error|debug|setError|setMessage|setNotice|blocker)$/;
// Properties that hold words: messages, labels and the EN/HI dictionaries.
const WORDS_PROP = /^(message|error|title|description|label|text|body|hint|placeholder|alt|heading|subtitle|summary|detail|reason|help|tip|note|cta|actionLabel|aria\w*|en|hi)$/i;
const WORDS_ATTR = /^(title|placeholder|alt|label|aria-[\w-]+)$/;
const DIRECTIVE = /[@#]__(PURE|NO_SIDE_EFFECTS|INLINE)__|webpack\w*\s*:|turbopack\w*\s*:|@vite-ignore|@jsx\w*|@ts-(ignore|expect-error|nocheck)|eslint-disable/g;

/** Whether a literal ends up where words go. Walks up through `+`, `??`/`||` (right side), `a ? b : c`, parens, `as`. */
function wordsPlace(ts, literal) {
  let node = ts.isTemplateSpan(literal.parent) ? literal.parent.parent : ts.isTemplateExpression(literal.parent) ? literal.parent : literal;
  for (;;) {
    const parent = node.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) { node = parent; continue; }
    if (ts.isConditionalExpression(parent) && parent.condition !== node) { node = parent; continue; }
    if (ts.isTemplateSpan(parent)) { node = parent.parent; continue; }
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken || ((op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) && parent.right === node)) {
        node = parent;
        continue;
      }
      return false;
    }
    if (ts.isJsxExpression(parent)) {
      node = parent;
      if (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent)) return true;
      continue;
    }
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return literal.kind === ts.SyntaxKind.JsxText;
    if (ts.isJsxAttribute(parent)) return WORDS_ATTR.test(parent.name.getText());
    if (ts.isPropertyAssignment(parent)) return parent.initializer === node && WORDS_PROP.test(parent.name.getText());
    if (ts.isNewExpression(parent)) return /Error$/.test(parent.expression.getText()) && parent.arguments?.includes(node);
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      return SHOW.test(name) && parent.arguments.includes(node);
    }
    return false;
  }
}

/** Every node's kind in pre-order (the tree's shape) and its leaf tokens; null when the file doesn't parse. */
function parse(ts, fileName, text) {
  const kind = /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : /\.m?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  if (file.parseDiagnostics?.length) return null;
  const shape = [];
  const leaves = [];
  const walk = (node) => {
    shape.push(node.kind);
    const children = node.getChildren(file);
    if (!children.length && node.kind !== ts.SyntaxKind.EndOfFileToken) leaves.push(node);
    for (const child of children) walk(child);
  };
  walk(file);
  return { file, shape, leaves };
}

/** A literal's words; a template part stands for its whole template, with N for each expression. */
function wordsOf(ts, node, file) {
  if (node.kind === ts.SyntaxKind.JsxText) return node.getText(file);
  const template = ts.isTemplateExpression(node.parent) ? node.parent : ts.isTemplateSpan(node.parent) ? node.parent.parent : null;
  return template ? template.head.text + template.templateSpans.map((span) => `N${span.literal.text}`).join("") : node.text;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Whether a source line reads `run` as code: a string holding it is searched (`includes(`…), compared (`===`,
 * `case`), turned into a RegExp, listed in an array a lookup takes, or named as a constant; or a regex literal
 * holds it. A line that only shows the words (a message, a throw) doesn't count.
 */
export function matches(line, run) {
  const str = `["'\`][^"'\`]*${escape(run)}`;
  return new RegExp(`\\b(includes|startsWith|endsWith|indexOf|lastIndexOf|match|matchAll|test|search|exec|replace|replaceAll|split|has|get|RegExp)\\s*\\(\\s*${str}`
    + `|[!=]==?\\s*${str}|${str}[^"'\`]*["'\`]\\s*[!=]==?|\\bcase\\s+${str}|\\[\\s*${str}|\\b(const|let|var)\\s+\\w+\\s*(:[^=]+)?=\\s*${str}`
    + `|(^|[(=,:!&|?{;]|\\breturn)\\s*\\/(?![/*])[^/\\n]*${escape(run)}[^/\\n]*\\/[dgimsuyv]*`).test(line);
}

/** Three-word runs: a string matcher elsewhere (`includes("token expired")`) shares one with the words it reads. */
export function wordRuns(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return [words.join(" ")];
  return words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(" "));
}

/**
 * True when base and head have the same tree and the same tokens in order (comments ignored, bundler directives
 * unchanged), and every token that differs is a string, template part or JSX text that is prose, sits in a
 * words place, and shares no three-word run with any other file (`elsewhere(run)`, fail closed) or with a
 * string this file's code reads.
 * @param {typeof import("typescript")} ts
 * @param {string} fileName
 * @param {string | null} base the file at the PR's merge base
 * @param {string | null} head the file at the PR head
 * @param {(run: string) => boolean} [elsewhere] whether `run` appears in a source file other than this one
 * @param {string[]} [why] gets the reason when the answer is false
 */
export function wordsOnly(ts, fileName, base, head, elsewhere = () => true, why = []) {
  const no = (reason) => { why.push(reason); return false; };
  if (!ts || base == null || head == null || base === head || !/\.(ts|tsx|js|jsx|mjs)$/.test(fileName)) return no("not a changed JS/TS file on both sides");
  if (JSON.stringify(base.match(DIRECTIVE) ?? []) !== JSON.stringify(head.match(DIRECTIVE) ?? [])) return no("a bundler or compiler directive changed");
  const a = parse(ts, fileName, base);
  const b = parse(ts, fileName, head);
  if (!a || !b) return no("doesn't parse");
  if (a.shape.length !== b.shape.length || a.shape.some((k, i) => k !== b.shape[i])) return no("code changed (the syntax tree differs)");
  const K = ts.SyntaxKind;
  const literal = [K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.JsxText];
  // Strings this file's code reads (not shown to a person): a matcher here shares a run with the words it reads.
  const codeStrings = (side) => side.leaves.filter((n) => literal.includes(n.kind) && !wordsPlace(ts, n)).map((n) => wordsOf(ts, n, side.file));
  const read = [...codeStrings(a), ...codeStrings(b)];
  for (let i = 0; i < a.leaves.length; i++) {
    const x = a.leaves[i];
    const y = b.leaves[i];
    if (x.getText(a.file) === y.getText(b.file)) continue;
    if (!literal.includes(y.kind)) return no(`code changed: ${y.getText(b.file).slice(0, 40)}`);
    for (const [node, side] of [[x, a], [y, b]]) {
      const words = wordsOf(ts, node, side.file);
      if (!prose(words)) return no(`not prose: "${words.slice(0, 40)}"`);
      if (!wordsPlace(ts, node)) return no(`not in a words place: "${words.slice(0, 40)}"`);
      for (const run of wordRuns(words)) {
        if (read.some((text) => text.includes(run)) || elsewhere(run)) return no(`code may match "${run}"`);
      }
    }
  }
  return true;
}
