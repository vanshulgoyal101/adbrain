import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.TRACKING_UI_OUTPUT;
if (output) await mkdir(output, { recursive: true });

const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const font = (await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`)).toString("base64");
const fonts = new Map(await Promise.all(["latin", "latin-ext"].map(async (subset) => {
  const path = `/node_modules/@fontsource-variable/dm-sans/files/dm-sans-${subset}-wght-normal.woff2`;
  return [path, await readFile(`${root}${path.slice(1)}`)];
})));
const bundle = await build({
  stdin: {
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { BrandTrackingCard } from "./src/components/brand-tracking-card";
      import { WebsiteDestinationFields } from "./src/components/campaign-destination";
      import { CampaignLaunchReview } from "./src/components/campaign-launch-review";

      const hi = location.search.includes("hi");
      document.documentElement.lang = hi ? "hi" : "en";
      window.fixture = { checks: [], goals: [], submits: 0 };
      const tracking = {
        pixelId: "101",
        status: {
          state: "ready", unreadable: null, pixelId: "101",
          pixels: [
            { id: "101", name: "Main website", lastFiredAt: null, unavailable: false },
            { id: "202", name: "Other website", lastFiredAt: null, unavailable: false },
          ],
          window: { since: "2026-10-28T00:00:00+0000", until: "2026-11-04T00:00:00+0000" },
          lastSeenAt: null, counts: { Lead: 12, Purchase: 0 }, totalEvents: 12,
        },
      };
      const card = hi ? {
        title: "वेबसाइट ट्रैकिंग", intro: "सिर्फ वेबसाइट लीड या बिक्री के लिए ज़रूरी।",
        legend: "AdBrain को कौन-सा ट्रैकिंग स्रोत इस्तेमाल करना चाहिए?",
        noSource: "इस विज्ञापन खाते के लिए वेबसाइट ट्रैकिंग का कोई स्रोत उपलब्ध नहीं है।",
        noSourceHelp: "Meta का ऐक्सेस जाँचें या Events Manager खोलें।",
        unreadable: "हम इस विज्ञापन खाते की ट्रैकिंग जाँच नहीं सके।", unreadableHelp: "Meta का ऐक्सेस जाँचें, फिर से कोशिश करें।",
        choose: "इस्तेमाल करने के लिए ट्रैकिंग स्रोत चुनें।", quiet: "Meta को हाल में कोई इवेंट नहीं मिला।",
        missing: "Meta को एक या ज़्यादा इवेंट नहीं मिले।", selectionUnavailable: "ट्रैकिंग स्रोत चुनना अभी उपलब्ध नहीं है।",
        pixelUnavailable: "उपलब्ध नहीं", unnamed: n => "ट्रैकिंग स्रोत " + n,
        leadCount: n => "वेबसाइट लीड (Lead): " + n, purchaseCount: n => "बिक्री (Purchase): " + n,
        window: (a, b) => "जाँच की अवधि " + a + " से " + b, countsNote: "ये Meta के इवेंट हैं, सत्यापित ऑर्डर नहीं।",
        checkAgain: "फिर से जाँचें", checking: "जाँच रहे हैं…", checkAccess: "Meta का ऐक्सेस जाँचें", eventsManager: "Events Manager खोलें",
      } : {
        title: "Website tracking", intro: "Only needed for website leads or sales.",
        legend: "Which tracking source should AdBrain use?", noSource: "No website tracking source is available to this ad account.",
        noSourceHelp: "Check Meta access or open Events Manager.", unreadable: "We couldn't check tracking for this ad account.",
        unreadableHelp: "Check Meta access, then try again.", choose: "Choose which tracking source to use.",
        quiet: "Meta hasn't seen any recent events.", missing: "Meta hasn't seen one or more events.",
        selectionUnavailable: "Choosing a tracking source is not available yet.", pixelUnavailable: "Unavailable",
        unnamed: n => "Tracking source " + n, leadCount: n => "Website leads (Lead): " + n,
        purchaseCount: n => "Sales (Purchase): " + n, window: (a, b) => "Checked from " + a + " to " + b,
        countsNote: "These are Meta events, not verified orders.", checkAgain: "Check again", checking: "Checking…",
        checkAccess: "Check Meta access", eventsManager: "Open Events Manager",
      };
      const goals = hi ? {
        legend: "आप अपनी वेबसाइट से क्या चाहते हैं?", visits: "विज़िट", leads: "वेबसाइट लीड", sales: "बिक्री",
        needsTracking: "ट्रैकिंग चाहिए", unavailable: "अभी उपलब्ध नहीं", noSource: card.noSource, chooseTracking: card.choose,
        unreadable: card.unreadable, quiet: card.quiet, missing: "Meta को इस लक्ष्य का इवेंट नहीं मिला।", finish: "ट्रैकिंग सेटअप पूरा करें",
      } : {
        legend: "What do you want from your website?", visits: "Visits", leads: "Website leads", sales: "Sales",
        needsTracking: "Needs tracking", unavailable: "Not available yet", noSource: card.noSource, chooseTracking: card.choose,
        unreadable: card.unreadable, quiet: card.quiet, missing: "Meta hasn't seen the event for this goal.", finish: "Finish tracking setup",
      };
      const reviewCopy = {
        goals: {
          visits: { label: goals.visits, hint: hi ? "लोग आपकी वेबसाइट देख सकते हैं।" : "People can visit your website." },
          leads: { label: goals.leads, hint: hi ? "Meta आपकी वेबसाइट से भेजे गए Lead इवेंट गिनता है। ये AdBrain से सत्यापित ग्राहक नहीं हैं।" : "Meta counts Lead events from your website, not customers verified by AdBrain." },
          sales: { label: goals.sales, hint: card.countsNote },
        },
        attributionLabel: hi ? "नतीजे गिनने की अवधि" : "Results counted within",
        attributionHelp: hi ? "Meta इस अवधि के क्लिक या विज्ञापन देखने के बाद आए नतीजे गिनता है।" : "Meta counts results after clicks or views in this period.",
        attributionUnavailable: hi ? "पुष्टि नहीं हुई" : "Not confirmed",
      };
      function App() {
        const [goal, setGoal] = useState("visits");
        return <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
          <form onSubmit={event => { event.preventDefault(); window.fixture.submits++; }}>
            <BrandTrackingCard tracking={tracking} copy={card} onCheckAgain={id => window.fixture.checks.push(id)} />
          </form>
          <WebsiteDestinationFields website="example.com" goalChoice={{
            value: goal, tracking, copy: goals, onChange: value => { window.fixture.goals.push(value); setGoal(value); },
          }} />
          <CampaignLaunchReview selectedCount={1} budget={500} destination="website" website="example.com" audience="Jaipur"
            websiteReview={{ goal: "leads", attribution: "28-day click / 1-day view", copy: reviewCopy }} />
        </main>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    `,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "offline-next-link",
    setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: 'import React from "react"; export default function Link(props){return React.createElement("a",props)}',
        resolveDir: root,
        loader: "js",
      }));
    },
  }],
});

async function clickRadioLabel(page, radio) {
  const label = radio.locator("..");
  await label.scrollIntoViewIfNeeded();
  const box = await label.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    for (const width of [360, 390, 1440]) {
      for (const lang of ["en", "hi"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        const unexpected = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (url.hostname === "tracking-fixture.test" && url.pathname === "/") {
            return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
          }
          if (url.hostname === "tracking-fixture.test" && fonts.has(url.pathname)) {
            return route.fulfill({ contentType: "font/woff2", body: fonts.get(url.pathname) });
          }
          unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
          return route.abort();
        });
        await page.goto(`http://tracking-fixture.test/?${lang}`);
        await page.addStyleTag({ content: `${css.css}\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}` });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.getByRole("region", { name: lang === "hi" ? "वेबसाइट ट्रैकिंग" : "Website tracking" }).waitFor();
        await page.evaluate(() => document.fonts.ready);

        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          offscreen: [...document.querySelectorAll("main label, main a, main button, main legend, main p, main dt, main dd")]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width && (rect.left < -1 || rect.right > innerWidth + 1);
            }).map((node) => node.textContent?.trim().slice(0, 80)),
        }));
        assert.ok(dimensions.document <= dimensions.viewport + 1, `${engineName} ${width} ${lang}: document overflow`);
        assert.deepEqual(dimensions.offscreen, [], `${engineName} ${width} ${lang}: a control or text overflows`);
        const hostLines = await page.locator('section[aria-labelledby="launch-review-title"]').getByText("example.com", { exact: true })
          .evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getClientRects().length;
          });
        assert.equal(hostLines, 1, `${engineName} ${width} ${lang}: a short website host is unnecessarily broken`);

        const chosen = page.getByRole("radio", { name: "Main website" });
        const other = page.getByRole("radio", { name: "Other website" });
        assert.equal(await other.getAttribute("aria-disabled"), "true");
        await other.focus();
        const focus = await other.locator("..").evaluate((node) => {
          const style = getComputedStyle(node);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
        });
        assert.notEqual(focus.style, "none", `${engineName} ${width} ${lang}: tracking radio has no visible focus outline`);
        assert.ok(focus.width >= 2, `${engineName} ${width} ${lang}: tracking radio focus outline is too thin`);
        await clickRadioLabel(page, other);
        assert.equal(await chosen.isChecked(), true);
        const checkButton = page.getByRole("button", { name: lang === "hi" ? "फिर से जाँचें" : "Check again" });
        await checkButton.click();

        const visits = page.getByRole("radio", { name: lang === "hi" ? "विज़िट" : "Visits" });
        const leads = page.getByRole("radio", { name: lang === "hi" ? "वेबसाइट लीड" : "Website leads" });
        await checkButton.focus();
        for (let tab = 0; tab < 8 && !(await visits.evaluate((node) => document.activeElement === node)); tab++) {
          await page.keyboard.press("Tab");
        }
        assert.equal(await visits.evaluate((node) => document.activeElement === node), true);
        const goalFocus = await visits.locator("..").evaluate((node) => {
          const style = getComputedStyle(node);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
        });
        assert.notEqual(goalFocus.style, "none", `${engineName} ${width} ${lang}: goal radio has no visible focus outline`);
        assert.ok(goalFocus.width >= 2, `${engineName} ${width} ${lang}: goal radio focus outline is too thin`);
        await clickRadioLabel(page, leads);
        assert.equal(await visits.isChecked(), true);
        await visits.focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await visits.isChecked(), true);
        assert.deepEqual(await page.evaluate(() => window.fixture), { checks: ["101"], goals: [], submits: 0 });

        for (const label of await page.locator("main label").all()) {
          const box = await label.boundingBox();
          assert.ok(box && box.height >= 44, `${engineName} ${width} ${lang}: radio target is under 44px`);
        }
        assert.deepEqual(errors, [], `${engineName} ${width} ${lang}: JavaScript error`);
        assert.deepEqual(unexpected, [], `${engineName} ${width} ${lang}: unexpected network request`);
        if (output) await page.screenshot({ path: `${output}/${engineName}-${width}-${lang}.png`, fullPage: true });
        await page.close();
        console.log(`${engineName} ${width}px ${lang}: fixture layout, focus, gated goals and recheck passed`);
      }
    }
  } finally {
    await browser.close();
  }
}
