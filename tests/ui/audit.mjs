// Layout audit: every visible control on every view and in the Remote, at 360/412 px (touch) and 768/1280 px
// (mouse): touch targets of 44 px (24 px with a mouse), no cut-off labels, every control named. See tests/ui/README.md.
import {chromium} from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "rf919-")), BASE = process.env.APP_URL || "http://localhost:8919/";
const b = await chromium.launch({executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true});
const report = {};
for (const w of [360, 412, 768, 1280]) {
  const h = w < 700 ? 800 : 900;
  const page = await (await b.newContext({viewport: {width: w, height: h}, deviceScaleFactor: w < 700 ? 2 : 1, hasTouch: w < 700, isMobile: w < 700})).newPage();
  await page.goto(`${BASE}?demo#f=11620`);
  await page.waitForFunction(() => state.ok && waiters.freq && view.data, null, {timeout: 20000});
  await page.waitForTimeout(1500);
  for (const t of ["radio", "explore", "memories", "more", "remote"]) {
    if (t === "remote") await page.evaluate(() => document.getElementById("remote").showModal());
    else { await page.evaluate((t) => go(t), t); }
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => d.open = true));
    await page.waitForTimeout(500);
    const issues = await page.evaluate((t) => {
      const out = [];
      const root = t === "remote" ? document.getElementById("remote") : document;
      for (const el of root.querySelectorAll("button, select, input, a, summary, textarea")) {
        if (t !== "remote" && el.closest("dialog")) continue;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
        const name = (el.getAttribute("aria-label") || el.textContent || el.value || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
        // inline links inside running text and the band select overlay are exempt from the size check
        const inline = el.tagName === "A" && el.closest("p, small, .note, .tags") && !el.classList.contains("tag");
        const overlay = el.matches(".band-pick select, .seg input, input[type=file]");
        const row = el.matches("[role=switch]") && el.closest("label.item");
        const tgt = row ? row.getBoundingClientRect() : overlay ? el.parentElement.getBoundingClientRect() : r;
        // 44 px is the touch guideline; with a mouse (wide screens here) WCAG 2.5.8 asks for 24 px
        const min = matchMedia("(pointer: coarse)").matches ? 43.5 : 24;
        if (!inline && el.type !== "hidden" && (tgt.height < min || tgt.width < min)) out.push(`small ${Math.round(tgt.width)}x${Math.round(tgt.height)} ${el.tagName.toLowerCase()} "${name}"`);
        if (el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 1) out.push(`clipped "${name}"`);
        const label = el.getAttribute("aria-label") || el.textContent.trim() || el.labels?.[0]?.textContent.trim() || el.getAttribute("title");
        if (!label && !["file"].includes(el.type)) out.push(`no name: ${el.tagName.toLowerCase()}#${el.id}`);
      }
      return [...new Set(out)];
    }, t);
    report[`${w} ${t}`] = issues;
    await page.screenshot({path: `${OUT}/audit-${w}-${t}.png`, fullPage: t !== "remote" && w >= 768});
    if (t === "remote") await page.evaluate(() => document.getElementById("remote").close());
  }
}
for (const [k, v] of Object.entries(report)) console.log(k.padEnd(14), v.length ? v.join(" | ") : "ok");
await b.close();
