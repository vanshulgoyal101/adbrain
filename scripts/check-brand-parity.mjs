import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brain } from "lucide-react";
import { parse } from "node-html-parser";

const paths = markup => parse(markup).querySelectorAll("path").map(path => path.getAttribute("d"));
const expected = paths(renderToStaticMarkup(createElement(Brain)));
const files = [
  "../public/logo.svg",
  "../public/icon.svg",
  "../../vanshul-portfolio/public/images/projects/adbrain-icon.svg",
];
for (const file of files) {
  assert.deepEqual(paths(await readFile(new URL(file, import.meta.url), "utf8")), expected, file);
}
const links = parse(await readFile(new URL("../../vanshul-links/index.html", import.meta.url), "utf8"));
assert.deepEqual(paths(links.querySelector('[data-project="adbrain"] svg').outerHTML), expected, "Links product mark");
console.log("AdBrain, Portfolio, and Links canonical Brain geometry: PASS");