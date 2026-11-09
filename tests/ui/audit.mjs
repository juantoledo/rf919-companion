// Layout audit: every visible control on every view, in the Remote and in the tools sheet; phones in portrait and
// landscape (touch) and two mouse sizes, each in the light and the dark theme. Reports touch targets under 44 px
// (24 px with a mouse), cut-off labels, unnamed controls, pages wider than the screen, and views that scroll further than
// their budget. See tests/ui/README.md.
import {chromium} from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "rf919-")), BASE = process.env.APP_URL || "http://localhost:8919/";
const b = await chromium.launch({executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true});
const SIZES = [[360, 640, true], [360, 780, true], [390, 844, true], [412, 915, true], [780, 360, true], [844, 390, true], [915, 412, true], [932, 430, true], [768, 1024, false], [1280, 800, false]];
// How far each view may scroll (px), per screen. The Log depends on how much it holds, so it has a limit for where its
// first row starts and how tall a row is instead
const BUDGET = {
  "390x844": {radio: 0, "explore-home": 0, explore: 150, memories: 0, more: 190},
  "360x640": {radio: 200, "explore-home": 60, explore: 450, memories: 100, more: 400},
  "844x390": {radio: 200, "explore-home": 60, explore: 350, memories: 150, more: 400},
  "1280x800": {radio: 0, "explore-home": 0, explore: 0, memories: 0, more: 0},
};
const LOG_FIRST_ROW = 195, LOG_ROW = 60;  // (the first row sits under the bar, the large title, the filter chips and its day's heading)
const overBudget = (page, size, t) => page.evaluate(({max, t, LOG_FIRST_ROW, LOG_ROW}) => {
  const out = [];
  if (max != null) { const s = document.documentElement.scrollHeight - innerHeight; if (s > max) out.push(`over budget: scrolls ${s}px, allowed ${max}`); }
  const row = t === "log" && document.querySelector(".log-row");
  if (row) {
    const r = row.getBoundingClientRect();
    if (r.top + scrollY > LOG_FIRST_ROW) out.push(`over budget: first Log row at ${Math.round(r.top + scrollY)}px`);
    if (r.height > LOG_ROW) out.push(`over budget: Log row ${Math.round(r.height)}px tall`);
  }
  return out;
}, {max: BUDGET[size]?.[t], t, LOG_FIRST_ROW, LOG_ROW});
const report = {};
// Every visible control of view t (or of the dialog t): its size, a cut-off label, a name; and the page's width
const issuesOf = (page, t) => page.evaluate((t) => {
  const out = [];
  const dialog = t === "remote" || t === "tools" ? document.getElementById(t) : t === "nobt-sheet" ? document.getElementById("tools") : null;
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page ${document.documentElement.scrollWidth}px wide`);
  for (const el of (dialog || document).querySelectorAll("button, select, input, a, textarea")) {
    if (!dialog && el.closest("dialog")) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[hidden], [aria-hidden=true]")) continue;
    const name = (el.getAttribute("aria-label") || el.textContent || el.value || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
    // inline links inside running text and the band select overlay are exempt from the size check
    const inline = el.tagName === "A" && el.closest("p, small, .note, .tags, .st-sub") && !el.classList.contains("tag");
    const overlay = el.matches(".band-pick select, .seg input, input[type=file]");
    const row = el.matches("[role=switch]") && el.closest("label.item");
    const tgt = row ? row.getBoundingClientRect() : overlay ? el.parentElement.getBoundingClientRect() : r;
    // 44 px on touch (Apple: a control's default size and hit region); with a mouse WCAG 2.5.8 asks for 24 px
    const min = matchMedia("(pointer: coarse)").matches ? 43.5 : 24;
    if (!inline && el.type !== "hidden" && (tgt.height < min || tgt.width < min)) out.push(`small ${Math.round(tgt.width)}x${Math.round(tgt.height)} ${el.tagName.toLowerCase()} "${name}"`);
    if (el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 1) out.push(`clipped "${name}"`);
    const label = el.getAttribute("aria-label") || el.textContent.trim() || el.labels?.[0]?.textContent.trim() || el.getAttribute("title");
    if (!label && !["file"].includes(el.type)) out.push(`no name: ${el.tagName.toLowerCase()}#${el.id}`);
  }
  return [...new Set(out)];
}, t);
for (const scheme of ["dark", "light"]) for (const [w, h, touch] of SIZES) {
  const ctx = await b.newContext({viewport: {width: w, height: h}, colorScheme: scheme, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch});
  await ctx.addInitScript(() => { delete Navigator.prototype.bluetooth; });  // as in Firefox and Safari: Connect opens the sheet saying so
  // A log to lay out: two saved entries (one starred), and the replay's own once the radio has stayed a moment
  await ctx.addInitScript(() => { if (!localStorage.getItem("rf919.log")) localStorage.setItem("rf919.log", JSON.stringify([
    {id: "a", k: 9580, band: "SW", mode: "AM", start: Date.now() - 864e5, end: Date.now() - 862e5, rssi: 30, snr: 11, station: "Radio Romania International", flag: "ro", star: true},
    {id: "b", k: 101300, band: "FM", mode: "FM", start: Date.now() - 3e6, end: Date.now() - 2e6, rssi: 52, snr: 30, station: "Radio Bío-Bío", flag: "cl", star: false}])); });
  const page = await ctx.newPage();
  // Not connected: the connect card on Radio, the mini player's pill (Connect radio · No radio) elsewhere; then No radio
  const shot = async (t) => {
    await page.waitForTimeout(400);
    report[`${scheme} ${w}x${h} ${t}`] = await issuesOf(page, t);
    await page.screenshot({path: `${OUT}/audit-${scheme}-${w}x${h}-${t}.png`});
  };
  await page.goto(`${BASE}#radio`); await shot("idle-radio");
  await page.evaluate(() => go("explore")); await shot("idle-explore");
  // Connect without Web Bluetooth: the sheet that says so; its Use No radio starts it
  await page.click('#radiobar [data-act="connect"]');
  await page.waitForFunction(() => document.getElementById("tools").open);
  await shot("nobt-sheet");
  await page.click('#nobt-pane [data-act="noradio"]');
  await page.waitForFunction(() => state.ok && state.virtual && waiters.freq, null, {timeout: 10000});
  await page.evaluate(() => go("radio")); await shot("noradio-radio");
  await page.goto(`${BASE}?demo#f=11620`);
  await page.waitForFunction(() => state.ok && waiters.freq && view.data, null, {timeout: 20000});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { logbook.dwellMs = 100; });
  for (const t of ["radio", "explore-home", "explore", "memories", "log", "more", "remote", "tools"]) {
    if (t === "remote") await page.evaluate(() => {
      document.getElementById("remote").showModal();
      document.querySelectorAll("#remote [data-pane]").forEach((p) => { p.hidden = false; });
    });
    else if (t === "tools") await page.evaluate(() => {
      document.getElementById("tools").showModal();
      document.querySelectorAll("#tools .tool").forEach((p) => { p.hidden = false; });
    });
    // Explore's home: search, chips, the bands shelf and Discover
    else if (t === "explore-home") await page.evaluate(() => { go("explore"); document.getElementById("x-back").click(); });
    // Explore's detail on a repeater, so station tags and the facts grid are on show too
    else if (t === "explore") { await page.evaluate(() => { location.hash = "#f=146730"; }); await page.waitForFunction(() => view.k === 146730 && view.data, null, {timeout: 20000}); }
    else await page.evaluate((t) => go(t), t);
    await page.waitForTimeout(500);
    const issues = [...await issuesOf(page, t), ...await overBudget(page, `${w}x${h}`, t)];
    report[`${scheme} ${w}x${h} ${t}`] = issues;
    await page.screenshot({path: `${OUT}/audit-${scheme}-${w}x${h}-${t}.png`});
    if (t === "remote" || t === "tools") await page.evaluate((t) => document.getElementById(t).close(), t);
  }
  await ctx.close();
}
// Larger Text at 200%, as Apple asks: nothing cut off, nothing wider than the screen. (Set on the root, which is what iOS's own
// setting moves; the bars keep their size on purpose, as the system's do.)
{
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true});
  const page = await ctx.newPage();
  await page.goto(`${BASE}?demo#radio`);
  await page.waitForFunction(() => state.ok && waiters.freq, null, {timeout: 20000});
  await page.addStyleTag({content: "html { font-size: 200% !important; }"});
  for (const t of ["radio", "explore", "memories", "log", "more", "remote", "tools"]) {
    if (t === "remote" || t === "tools") await page.evaluate((t) => { const d = document.getElementById(t); d.showModal(); d.querySelectorAll("[data-pane], .tool").forEach((p) => { p.hidden = false; }); }, t);
    else await page.evaluate((t) => go(t), t);
    await page.waitForTimeout(400);
    report[`large-text ${t}`] = (await issuesOf(page, t)).filter((i) => /clipped|wide/.test(i));
    await page.screenshot({path: `${OUT}/audit-large-text-${t}.png`});
    if (t === "remote" || t === "tools") await page.evaluate((t) => document.getElementById(t).close(), t);
  }
  await ctx.close();
}
let bad = 0;
for (const [k, v] of Object.entries(report)) { if (v.length) bad++; console.log(k.padEnd(26), v.length ? v.join(" | ") : "ok"); }
console.log(`\n${Object.keys(report).length - bad}/${Object.keys(report).length} ok`);
if (Object.entries(report).some(([k, v]) => v.some((i) => i.startsWith("over budget") || (k.startsWith("large-text") && i)))) process.exitCode = 1;
await b.close();
