// Layout audit: every visible control on every view, in the Remote and in the tools sheet; phones in portrait and
// landscape (touch) and two mouse sizes, each in the light and the dark theme. Reports touch targets under 48 px
// (24 px with a mouse), cut-off labels, unnamed controls and pages wider than the screen. See tests/ui/README.md.
import {chromium} from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "rf919-")), BASE = process.env.APP_URL || "http://localhost:8919/";
const b = await chromium.launch({executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true});
const SIZES = [[360, 780, true], [412, 915, true], [780, 360, true], [915, 412, true], [932, 430, true], [768, 1024, false], [1280, 800, false]];
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
    const inline = el.tagName === "A" && el.closest("p, small, .note, .tags") && !el.classList.contains("tag");
    const overlay = el.matches(".band-pick select, .seg input, input[type=file]");
    const row = el.matches("[role=switch]") && el.closest("label.item");
    const tgt = row ? row.getBoundingClientRect() : overlay ? el.parentElement.getBoundingClientRect() : r;
    // 48 px on touch (Android 48 dp, iOS 44 pt); with a mouse WCAG 2.5.8 asks for 24 px
    const min = matchMedia("(pointer: coarse)").matches ? 47.5 : 24;
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
    const issues = await issuesOf(page, t);
    report[`${scheme} ${w}x${h} ${t}`] = issues;
    await page.screenshot({path: `${OUT}/audit-${scheme}-${w}x${h}-${t}.png`});
    if (t === "remote" || t === "tools") await page.evaluate((t) => document.getElementById(t).close(), t);
  }
  await ctx.close();
}
let bad = 0;
for (const [k, v] of Object.entries(report)) { if (v.length) bad++; console.log(k.padEnd(26), v.length ? v.join(" | ") : "ok"); }
console.log(`\n${Object.keys(report).length - bad}/${Object.keys(report).length} ok`);
await b.close();
