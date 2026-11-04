// End-to-end checks of the web app in its Demo (the simulated radio): tabs and links, the Remote, gestures,
// band pickers, memories (store, check, Store here, clear, Start fresh), backup, switches, key capture, Near me, Explore (dial, strip, pins, Share, Discover, reminders, tune as you explore),
// keyboard. See tests/ui/README.md.
import {chromium} from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "rf919-")), URL = process.env.APP_URL || "http://localhost:8919/";
const b = await chromium.launch({executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true});
const ctx = await b.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, acceptDownloads: true,
  geolocation: {latitude: -33.45, longitude: -70.66}, permissions: ["geolocation"]});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404|ERR_FAILED|CORS/.test(m.text())) errors.push("console: " + m.text()); });
let n = 0;
const ok = (name) => { n++; console.log("✓", name); };
const E = (fn, arg) => page.evaluate(fn, arg);
const sent = () => E(() => [...document.querySelectorAll("#log div")].map((d) => d.textContent).filter((t) => /would send/.test(t)).map((t) => t.split("would send ")[1]));
const lastSent = async () => (await sent()).pop();
const done = () => page.waitForFunction(() => !mem.run, null, {timeout: 60000});
const confirmAsk = async () => {
  await page.waitForSelector("#ask[open]"); await page.click("#ask-ok");
  await page.waitForFunction(() => !document.getElementById("ask").open); await page.waitForTimeout(150);
};
// With View Transitions a tab's view shows a frame after the tap (once the old picture is taken)
const tab = async (t) => { await page.click(`#tabbar [data-tab="${t}"]`); await page.waitForFunction((t) => !document.getElementById(`view-${t}`).hidden && !document.documentElement.classList.contains("vt-run"), t); };
// Back/Forward and taps on Explore's home run a View Transition too: wait for it to end before the next gesture
const settled = () => page.waitForFunction(() => !document.documentElement.classList.contains("vt-run"));
// The tools of Memories and More open in one sheet; a modal sheet has to close before the page behind takes taps
const toolsOpen = () => E(() => document.getElementById("tools").open);
const closeTool = async () => { if (await toolsOpen()) { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.getElementById("tools").open); } };
const tool = async (id) => { await closeTool(); await page.click(`[data-tool="${id}"]`); await page.waitForFunction(() => document.getElementById("tools").open); };
const mode = () => E(() => document.getElementById("view-explore").dataset.mode);
const atHome = () => page.waitForFunction(() => location.hash === "#explore" && document.getElementById("view-explore").dataset.mode === "home" && !document.documentElement.classList.contains("vt-run"));
const visibleView = () => E(() => [...document.querySelectorAll(".view")].filter((v) => !v.hidden).map((v) => v.dataset.view).join());

await page.goto(URL); await E(() => localStorage.clear()); await page.goto(URL);

// ---- shell & routing ----
assert.equal(await visibleView(), "radio");
assert.equal(await page.locator("#connect-card").isVisible(), true);
assert.equal(await page.locator("#radiobar").isHidden(), true);
ok("starts on Radio with the connect card; no radio bar on Radio");
await tab("explore");
assert.equal(await visibleView(), "explore");
assert.equal(await E(() => location.hash), "#explore");
assert.equal(await mode(), "home");
await page.waitForSelector('#bands .chip[data-act="dial"]', {timeout: 15000});
const fold = 844 - 140;  // the tab bar and the mini player
// (Discover may go below it once On air now has cards to show)
for (const s of ["#search", "#bands"]) { const r = await page.locator(s).boundingBox(); assert.ok(r && r.y < fold, `${s} at ${r && r.y}`); }
assert.equal(await page.locator("#radiobar").isVisible(), true);
assert.equal(await page.locator("#radiobar .rb-off").isVisible(), true);
{ const r = await page.locator("#radiobar").boundingBox(); assert.ok(r.width < 260, `idle mini player ${r.width}px wide`); }
ok("Explore home: search and bands above the fold; with no radio the mini player is a pill (Connect radio · Demo)");
await page.fill("#q", "9580"); await page.press("#q", "Enter");
await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000});
assert.equal(await E(() => location.hash), "#f=9580");
assert.equal(await mode(), "detail");
assert.equal(await page.locator("#search").isHidden(), true);
{ const r = await page.locator("#dossier .d-actions").boundingBox(); assert.ok(r.y + r.height < fold, `actions at ${r.y}`); }
ok("a search opens 9580 as Explore's detail (#f=9580), its actions on the first screen");
await page.goBack(); await atHome();
assert.equal(await E(() => document.activeElement.dataset.look), "9580");
ok("system Back returns to Explore's home, the focus on 9580's chip");
// Record which elements carry the "freq" name in each View Transition's old and new pictures
await E(() => {
  const start = document.startViewTransition.bind(document);
  const named = () => [...document.querySelectorAll("#app *")].filter((e) => getComputedStyle(e).viewTransitionName === "freq")
    .map((e) => e.dataset.look || e.className);
  window.vtLog = [];
  document.startViewTransition = (cb) => { const old = named(); return start(() => { cb(); window.vtLog.push({old, new: named()}); }); };
});
await page.click('#recent [data-look="9580"]'); await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000});
await settled();
await page.click("#x-back"); await atHome();
ok("the bar's ← does the same");
assert.deepEqual(await E(() => window.vtLog), [{old: ["9580"], new: ["d-freq"]}, {old: ["d-freq"], new: ["9580"]}]);
ok("View Transitions: the tapped chip grows into the dial's digits, and Back shrinks them into it again");

// ---- search by name, On air now ----
await page.fill("#q", "radio");
await page.waitForSelector("#q-results .qr [data-look]", {timeout: 15000});
assert.match(await page.textContent("#q-results .qr-foot"), /^\d+ stations? · from \d+ of \d+ frequencies Search all$/);
const kq = +await page.getAttribute("#q-results .qr [data-look]", "data-look");
assert.match(await page.textContent("#q-results .qr .qr-name"), /radio/i);
await page.press("#q", "Enter");
await page.waitForFunction((k) => view.k === k && view.data, kq, {timeout: 15000});
assert.equal(await page.inputValue("#q"), "");
await settled(); await page.click("#x-back"); await atHome();
assert.equal(await page.locator("#q-results").isHidden(), true);
ok(`a station's name finds its frequencies (radio → ${kq}); Enter opens the first`);
await page.waitForSelector("#onair .oa-card", {timeout: 20000});
const ko = +await page.getAttribute("#onair .oa-card", "data-look");
assert.match(await page.textContent("#onair .oa-card small"), /until \d\d:\d\d UTC|pinned|recent/);
await page.click("#onair .oa-card");
await page.waitForFunction((k) => view.k === k && view.data, ko, {timeout: 15000});
await settled(); await page.click("#x-back"); await atHome();
ok(`On air now: cards for what's on air, from what's been looked up; a card opens its frequency (${ko})`);
await page.goto(URL + "#f=11620"); await page.waitForFunction(() => view.k === 11620 && view.data, null, {timeout: 15000});
assert.equal(await visibleView(), "explore");
assert.equal(await mode(), "detail");
await page.click("#x-back"); await atHome();
ok("a shared #f= link opens the detail; ← goes home without leaving the page");
await page.goBack(); await page.waitForTimeout(300);
ok("back button works without errors (" + await visibleView() + ")");

// ---- connect the demo from the radio bar ----
await page.goto(URL + "#explore");
await page.click('#radiobar [data-act="demo"]');
await page.waitForFunction(() => state.ok && waiters.freq, null, {timeout: 10000});
assert.equal(await page.locator("#radiobar .rb-off").isHidden(), true);
assert.equal(await page.textContent("#radiobar [data-freq]"), "11.6200");
assert.equal(await page.textContent("#radiobar [data-band-chip]"), "SW");
ok("Demo from the radio bar: it shows SW 11.6200");
await tab("radio");
await page.waitForFunction(() => view.k === 11620 && view.data, null, {timeout: 15000});
assert.equal(await page.locator("#readout").isVisible(), true);
assert.equal(await page.locator("#connect-card").isHidden(), true);
assert.equal(await E(() => document.getElementById("host-radio").contains(document.getElementById("dossier"))), true);
assert.equal(await E(() => { const now = document.getElementById("now"); return now.contains(document.getElementById("readout")) && now.contains(document.getElementById("dossier")); }), true);
// whoever is on air on 11620 changes with the UTC hour, so any country's flag will do
assert.match(await E(() => document.getElementById("now").style.getPropertyValue("--flag")), /\/[a-z]{2}(-[a-z]{2})?\.svg/);
assert.equal(await page.locator("#dossier .d-freq").count(), 0);  // the readout shows the frequency
ok("Radio: readout + controls; one card holds the readout and what's on the dial (11620), the station's flag behind");
await tab("explore");
assert.equal(await page.locator("#readout").isHidden(), true);
await page.click('#recent [data-look="9580"]');
await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000});
assert.equal((await page.textContent("#dossier .d-freq")).replace(/\D/g, ""), "9580");
assert.equal(await page.locator("#radio-controls").isHidden(), true);
ok("Explore hides the readout and controls while connected and shows the looked-up frequency");

// ---- Tune as you explore: a pick tunes the radio, Explore stays put ----
// FREQ presses the radio was sent (two per tune: open the entry, then enter it)
const freqKeys = () => E(() => {
  const f = [...frame(0x0C, [KEYS.FREQ])].map((x) => x.toString(16).padStart(2, "0")).join(" ");
  return [...document.querySelectorAll("#log div")].filter((d) => d.textContent.toLowerCase().endsWith("would send " + f)).length;
});
await page.waitForFunction(() => view.radioK === 9580 && document.querySelector("#dossier .tune-state.on"), null, {timeout: 15000});
assert.equal(await visibleView(), "explore");
assert.match(await page.textContent("#dossier .tune-state"), /On the radio/);
assert.match(await page.textContent("#toast-text"), /Explore tunes the radio/);
assert.equal(await page.textContent("#toast-act"), "Turn off");
ok("a pick on Explore tunes the radio (9580) and stays there; the card says On the radio; a first-time snackbar offers Turn off");
await page.waitForSelector('.dial-step[data-keep="dial1"]:not(:disabled)', {timeout: 15000});
const fk0 = await freqKeys();
for (let i = 0; i < 3; i++) await page.click('.dial-step[data-keep="dial1"]');
const kd = await E(() => view.k);
assert.ok(kd > 9580);
await page.waitForFunction((k) => view.radioK === k && document.querySelector("#dossier .tune-state.on"), kd, {timeout: 15000});
assert.equal(await freqKeys() - fk0, 2);
ok(`three quick steps along the dial tune once, to where it stops (${kd})`);
await page.click("#x-search"); await atHome();
await page.fill("#q", "101.3"); await page.press("#q", "Enter");
await page.waitForFunction(() => view.radioK === 101300 && waiters.freq.band === "FM", null, {timeout: 20000});
ok("a pick on another band (FM 101.3 from SW) switches the band first, then tunes");
await page.waitForFunction(() => /^Back to /.test(document.getElementById("toast-act").textContent), null, {timeout: 5000});
assert.match(await page.textContent("#toast-text"), /^Tuned 101300 kHz|^Tuned 101\.3/);
assert.equal(await page.textContent("#toast-act"), `Back to ${await E((k) => fmtKHz(k), kd)}`);
await page.click("#toast-act");
await page.waitForFunction((k) => view.radioK === k && waiters.freq.band === "SW", kd, {timeout: 20000});
ok("a pick from home offers Back to where the radio was; it retunes there (and back to SW)");
await E(() => { const t = document.getElementById("autotune"); t.click(); });
assert.equal(await E(() => localStorage.getItem("rf919.autotune")), "false");
await page.click("#x-back"); await atHome();
await page.click('#recent [data-look="11620"]');
await page.waitForFunction(() => view.k === 11620 && view.data, null, {timeout: 15000});
await page.waitForTimeout(900);
assert.equal(await E(() => view.radioK), kd);
assert.equal(await page.locator('#dossier [data-act="tunehere"]').isVisible(), true);
ok("with Tune as you explore off, a pick only looks up; Tune radio is back");
await page.click('#dossier [data-act="tunehere"]');
await page.waitForFunction(() => !document.getElementById("view-radio").hidden);
await page.waitForFunction(() => view.radioK === 11620, null, {timeout: 20000});
await page.goBack();
await page.waitForFunction(() => location.hash === "#f=11620" && document.getElementById("view-explore").dataset.mode === "detail");
assert.equal(await visibleView(), "explore");
ok("Tune radio goes to Radio, tuned; system Back returns to the frequency on Explore");
assert.equal(await page.locator("#x-back .bar-back-label").isVisible(), true);
assert.equal(await page.textContent("#x-back .bar-back-label"), "Explore");
await E(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(200);
if (await E(() => document.getElementById("view-explore").classList.contains("collapsed"))) assert.equal(await page.locator("#x-back .bar-back-label").isHidden(), true);
await E(() => window.scrollTo(0, 0));
await E(() => document.getElementById("autotune").click());
ok("the detail's back button reads ‹ Explore, the name giving way to the title once it collapses");
await tab("radio");
await page.waitForFunction(() => view.k === 11620 && view.data, null, {timeout: 15000});
assert.equal(await page.locator("#readout").isVisible(), true);
ok("back on Radio the readout and controls return");

// ---- the Log: what the radio stays on (a 30 s dwell, made short here), and the signal meter ----
await E(() => { logbook.dwellMs = 300; logbook.tick(Date.now()); });
await page.waitForFunction(() => logbook.entries.some((e) => e.k === 11620 && e.demo), null, {timeout: 6000});
await E(() => { link.onEvent({kind: "field", data: {name: "rssi", value: "28"}}); link.onEvent({kind: "field", data: {name: "snr", value: "9"}}); });
await page.waitForTimeout(150);
await E(() => { link.onEvent({kind: "field", data: {name: "rssi", value: "34"}}); link.onEvent({kind: "field", data: {name: "snr", value: "11"}}); });
await page.waitForSelector("#sig .sig-tile svg polyline");
assert.match(await page.getAttribute("#sig .sig-tile", "aria-label"), /^RSSI 34, best 34 in the last minute, rising/);
assert.equal(await page.locator("#sig .sig-tile").count(), 2);
ok("the signal meter: RSSI and SNR, each its value, its best and the last minute, under the readout");
await tab("log");
await page.waitForSelector(".log-row");
await page.waitForFunction(() => !/kHz/.test(document.querySelector(".log-row .log-open b").textContent), null, {timeout: 15000});
assert.match(await page.textContent(".log-row .log-open small"), /11620 kHz.*RSSI 34 · SNR 11.*Demo/);
assert.match(await page.textContent("#log-total"), /^Today · \d+/);
await page.click(".log-row .log-star");
assert.equal(await page.getAttribute(".log-row .log-star", "aria-pressed"), "true");
const nLog = await page.locator(".log-row").count();
// In one go: the Demo's recorded session shows the radio's own messages as snackbars every few seconds
assert.deepEqual(await E(() => {
  document.querySelector(".log-row .mr-del").click();
  const after = [document.querySelectorAll(".log-row").length, document.getElementById("toast-act").textContent];
  document.getElementById("toast-act").click();
  return [...after, document.querySelectorAll(".log-row").length];
}), [nLog - 1, "Undo", nLog]);
ok("the Log: an entry named from radiomap.cl, with its best signal; star it; ✕ deletes and Undo brings it back");
const [adi] = await Promise.all([page.waitForEvent("download"), page.click('#log-export [data-log="adif"]')]);
assert.match(adi.suggestedFilename(), /^rf919-log-\d{8}\.adi$/);
assert.match(fs.readFileSync(await adi.path(), "utf8"), /<FREQ:6>11\.620 .*<SWL:1>Y .*<EOR>/);
ok("the Log exports ADIF for logbook programs");
await page.click('#log-list .log-open');
await page.waitForFunction(() => view.k === 11620 && document.querySelector("#dossier .d-heard"), null, {timeout: 15000});
assert.match(await page.textContent("#dossier .d-heard"), /^Logged (once|\d+×) · last \d+ min ago/);
await page.click("#dossier .d-heard");
await page.waitForFunction(() => !document.getElementById("view-log").hidden);
assert.match(await page.textContent("#log-filter"), /11620 kHz ✕/);
await settled();
await tab("radio");
ok("a row opens its frequency on Explore; its card says Logged once, which opens the Log on it");

// ---- Liquid Glass: the blue accent, glass bars that shrink on scroll, search from anywhere, light under the finger ----
await tab("more");
assert.equal(await E(() => getComputedStyle(document.querySelector('#tabbar [aria-current="page"]')).color), "rgb(0, 98, 204)");
assert.match(await E(() => getComputedStyle(document.getElementById("tabbar")).backdropFilter), /blur\(20px\)/);
await E(() => window.scrollTo(0, 0)); await page.waitForTimeout(100);
await page.mouse.move(195, 400); await page.mouse.wheel(0, 700);
await page.waitForFunction(() => document.body.classList.contains("bars-min"));
await page.waitForTimeout(450);  // the bars settle
{ const tb = await page.locator("#tabbar").boundingBox(), rb = await page.locator("#radiobar").boundingBox(), sb = await page.locator("#tab-search").boundingBox();
  assert.ok(tb.width <= 64, `tab bar ${tb.width}px`);
  assert.ok(Math.abs((rb.y + rb.height / 2) - (tb.y + tb.height / 2)) < 4 && rb.x > tb.x + tb.width && rb.x + rb.width < sb.x, "mini player between"); }
await page.click('#tabbar [aria-current="page"]');
await page.waitForFunction(() => !document.body.classList.contains("bars-min"));
assert.equal(await visibleView(), "more");
ok("scrolled down, the tab bar shrinks to its current tab and the mini player rides beside it; a tap brings it back");
await page.click("#tab-search");
await page.waitForFunction(() => !document.getElementById("view-explore").hidden && document.activeElement.id === "q"); await settled();
await page.fill("#q", "9580"); await page.press("#q", "Enter");
await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000}); await settled();
await page.click("#tab-search"); await atHome();
assert.equal(await E(() => document.activeElement.id), "q");
ok("the glass search button: from any tab, or a frequency on Explore, to the search field");
{ const r = await page.locator('#tabbar [data-tab="log"]').boundingBox();
  await page.mouse.move(r.x + 10, r.y + 12); await page.mouse.down();
  assert.deepEqual(await E(() => { const s = document.querySelector('#tabbar [data-tab="log"]').style; return [s.getPropertyValue("--px"), s.getPropertyValue("--py")]; }), ["10px", "12px"]);
  await page.mouse.up(); await settled(); }
ok("glass answers the finger: the light sits where it's pressed");
{ const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-transparency", value: "reduce"}]});
  assert.equal(await E(() => getComputedStyle(document.getElementById("tabbar")).backdropFilter), "none");
  assert.equal(await E(() => getComputedStyle(document.body, "::before").display), "none");
  await cdp.send("Emulation.setEmulatedMedia", {features: []}); }
ok("Reduce Transparency: solid bars, no blur, no ambient light");
await tab("radio");

// ---- swipe on the readout (left = up, right = down; long = seek) ----
const box = await page.locator("#freqbox").boundingBox();
const swipe = async (dx, el = box) => { const y = el.y + el.height / 2, x = el.x + el.width / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, {steps: 4}); await page.mouse.move(x + dx, y, {steps: 4}); await page.mouse.up(); await page.waitForTimeout(150); };
await swipe(-80); assert.equal(await lastSent(), "ab 02 0c 0e c7");   // UP
await swipe(80); assert.equal(await lastSent(), "ab 02 0c 10 c9");    // DOWN
await swipe(-160); assert.equal(await lastSent(), "ab 02 0c 0f c8");  // UP long (seek)
ok("swipes on the readout: left UP, right DOWN, long left seeks");

// ---- the controls' dock: on screen however far the page scrolls, only on Radio ----
await E(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(200);
{ const d = await page.locator("#radio-controls").boundingBox(), vh = await E(() => innerHeight);
  assert.ok(d && d.y >= 0 && d.y + d.height <= vh, `dock at ${JSON.stringify(d)} in a ${vh}px viewport`); }
await page.click('#radio-controls [data-key="DOWN"]'); assert.equal(await lastSent(), "ab 02 0c 10 c9");
await E(() => window.scrollTo(0, 0));
ok("the controls' dock stays on screen scrolled to the bottom, and its keys send (DOWN)");

// ---- band select (native) ----
await page.selectOption("#readout [data-band-select]", "AIR");
await page.waitForFunction(() => waiters.freq.band === "AIR");
assert.equal(await lastSent(), "ab 06 10 03 00 00 00 00 c4");
assert.equal(await page.textContent("#band"), "AIR");
ok("the readout's native band select switches the radio to AIR");

// ---- Remote dialog ----
await page.click("#open-remote");
assert.equal(await E(() => document.getElementById("remote").open), true);
await settled(); await page.waitForTimeout(400);
await page.keyboard.press("Escape");
assert.equal(await E(() => document.getElementById("remote").open), false);
// closed, but still sliding away: display and the top layer are held until the transition ends
assert.ok(await E(() => document.getElementById("remote").getAnimations().length > 0));
assert.notEqual(await E(() => getComputedStyle(document.getElementById("remote")).display), "none");
await page.waitForFunction(() => getComputedStyle(document.getElementById("remote")).display === "none");
assert.equal(await E(() => document.activeElement.id), "open-remote");
ok("Keys opens the Remote; Esc closes it (it slides away) and focus returns");
await tab("memories");
assert.equal(await page.locator("#radio-controls").isHidden(), true);  // the dock is the Radio tab's
const rb = await page.locator("#rb-open").boundingBox();
{ const x = rb.x + rb.width / 2, y = rb.y + rb.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 60, {steps: 6}); await page.mouse.up(); }
await page.waitForFunction(() => document.getElementById("remote").open);
await page.screenshot({path: `${OUT}/e2e-remote.png`});
const grab = await page.locator("#remote-grab").boundingBox();  // the handle at the top of the sheet
{ const x = grab.x + grab.width / 2, y = grab.y + grab.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 140, {steps: 8}); await page.mouse.up(); }
await page.waitForFunction(() => !document.getElementById("remote").open, null, {timeout: 3000});
ok("swipe up on the radio bar opens the Remote; dragging its top down closes it");
await page.click("#rb-open");
await page.click('#remote [data-key="SQ"]'); assert.equal(await lastSent(), "ab 02 0c 20 d9");
await page.click('#remote [data-close]');
ok("a Remote key sends (SQ), ✕ closes");

// ---- Memories: per band, store, check, store here, clear, start fresh (ask dialogs) ----
await tool("mem-textbox");
assert.match(await page.textContent("#tools-title"), /Edit .* as text/);
await page.fill("#mem-text", "1 118.1 Torre\n2 121.9");
await page.click('[data-mem="apply"]');
assert.equal(await E(() => mem.list.map((e) => `${e.band}:${e.ch}`).join(" ")), "AIR:1 AIR:2");
await closeTool();
await page.check('#mem-counts input[value="FM"]');
await tool("mem-textbox");
await page.fill("#mem-text", "1 101.3 Radio Uno");
await page.click('[data-mem="apply"]');
await closeTool();
await page.check('#mem-counts input[value="AIR"]');
assert.equal(await page.locator("#mem-list .mem-row").count(), 2);
ok("Memories: band chips; text per band in the tools sheet (AIR 2, FM 1)");
await page.click('[data-mem="store"]'); await done();
await page.click('[data-mem="check"]'); await done();
assert.deepEqual(await E(() => [mem.check.n, mem.check.ok]), [2, 2]);
ok("Store 2 + Check 2 on AIR");
await page.click('[data-mem="clear"]');
assert.equal(await E(() => mem.list.filter((e) => e.band === "AIR").length), 0);
await page.click("#toast-act");  // Undo
assert.equal(await E(() => mem.list.filter((e) => e.band === "AIR").length), 2);
await page.click('#mem-list .mem-row:first-child .mr-del');
assert.equal(await E(() => mem.list.filter((e) => e.band === "AIR").length), 1);
await page.click('[data-mem="clear"]');
assert.equal(await E(() => mem.list.filter((e) => e.band === "AIR").length), 0);
ok("Clear the AIR list, then Undo from the snackbar; ✕ removes one row");
await tool("mem-fresh");
await page.click('[data-mem="fresh"]');
await page.waitForSelector("#ask[open]");
assert.match(await page.textContent("#ask-title"), /Wipe all AIR memories/);
assert.equal(await page.getAttribute("#ask-ok", "class"), "danger filled");
await page.screenshot({path: `${OUT}/e2e-ask.png`});
await page.click("#ask-no");
assert.equal(await E(() => mem.run), null);
await page.click('[data-mem="fresh"]'); await confirmAsk(); await done();
assert.equal(await E(() => [...link.sim.bank.keys()].filter((k) => k.startsWith("AIR")).length), 0);
ok("Start fresh: Cancel does nothing; Wipe AIR (danger) wipes it");
await closeTool();
await tab("radio");
await page.click("#storehere");
await page.waitForFunction(() => !mem.run && /Stored/.test(document.getElementById("toast").textContent), null, {timeout: 15000});
ok("Store here: " + await page.textContent("#toast"));

// ---- Backup ----
await tab("memories");
await tool("mem-backup");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-mem="bk-download"]')]);
const file = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(file);
assert.match(fs.readFileSync(file, "utf8"), /# RF919 memories/);
await E(() => { mem.record = {}; });
await page.setInputFiles("#backup-file", file);
await page.click('[data-mem="bk-mark"]');
assert.ok(await E(() => Object.keys(mem.record).length) > 0);
ok("Backup: download, then import as Already on radio");
await closeTool();

// ---- More: switches, key capture ----
await tab("more");
await page.click('label:has(#hold)');
assert.equal(await E(() => state.hold), true);
await page.click('label:has(#hold)');
assert.equal(await E(() => state.hold), false);
ok("Hold next key is a native switch");
await page.click('#theme-seg label:has(input[value="light"])');
assert.deepEqual(await E(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).colorScheme]), ["light", "light"]);
{ const p3 = await ctx.newPage(); await p3.goto(URL + "#more");  // remembered, and applied before the page draws
  assert.equal(await p3.evaluate(() => document.documentElement.dataset.theme), "light"); await p3.close(); }
await page.click('#theme-seg label:has(input[value="dark"])');
assert.equal(await E(() => getComputedStyle(document.body).colorScheme), "dark");
await page.click('#theme-seg label:has(input[value="system"])');
assert.equal(await E(() => document.documentElement.dataset.theme), undefined);
ok("Appearance: Light and Dark override the system, remembered across pages; System hands it back");
// Key capture: the test plays the radio, sending what its own buttons would make it report
await tool("capbox");
const caps = () => E(() => [...document.querySelectorAll("#cap-list .cap")].map((c) => c.textContent.replace(/\s+/g, " ")));
// Count what the page sends from here (the log keeps only its last lines, so counting them can go down)
await E(() => { window.sentN = 0; const send = link.send.bind(link); link.send = (p) => { window.sentN++; return send(p); }; });
await page.click("#cap-btn");
assert.match(await page.textContent("#cap-field"), /Press a button on the radio/);
await page.waitForTimeout(6500);  // a full round of the Demo's routine status updates: none of it is a press
assert.equal((await caps()).length, 0, (await caps()).join(" | "));
await page.click("#cap-btn");
// pause the recorded session, so only the test's "presses" reach the page; then a baseline for the STEP line
await E(() => { clearTimeout(link.timer); });
await E(() => link.sim.emit(frame(0x1C, [0x0B, 3, 10, ..."STEP:2.50K"].map((c) => typeof c === "string" ? c.charCodeAt(0) : c))));
await page.click("#cap-btn");
const play = async (fn) => { await E(fn); await page.waitForTimeout(1600); };
await play(() => link.sim.emit(frame(0x10, [1, 200, 0])));
await play(() => { let n = 0; const t = setInterval(() => { link.sim.kHz += 5; link.sim.sendFreq(); if (++n === 4) clearInterval(t); }, 120); });
await play(() => link.sim.emit(frame(0x1C, [0x0B, 3, 7, ..."STEP:5K"].map((c) => typeof c === "string" ? c.charCodeAt(0) : c))));
await play(() => link.sim.emit(frame(0x0B, [1])));
const got = await caps();
const has = (re) => assert.ok(got.some((c) => re.test(c)), `${re} not in: ${got.join(" | ")}`);
has(/^Memo \(Preset\): channel mode on.*Channel mode on: CH 200.*ab 04 10 01 c8 00 88/);
has(/^Scan or seek: the frequency is moving.*Frequency moving: 4 changes/);
has(/^A setting: STEP: 2\.50K → 5K/);
has(/^Unknown message: perhaps the key itself.*cmd 0b.*ab 02 0b 01 b9/);
assert.equal(got.length, 4, got.join(" | "));
assert.equal(await E(() => window.sentN), 0);  // the capture never sends anything
await page.click("#cap-btn");
assert.equal(await page.textContent("#cap-field"), "Off");
await page.locator("#capbox").scrollIntoViewIfNeeded();
await page.screenshot({path: `${OUT}/e2e-capture.png`});
ok("Key capture: channel mode, a running frequency, STEP 2.50K → 5K and an unknown message, each with its raw frames; routine updates ignored; nothing sent")

// ---- Log diagnostics: every notification; other channels in the capture ----
await tool("logpanel");
await page.click('label:has(#rawrx)');
await E(() => { link.connected = true; link.connect(); });  // restart the recorded session (paused by the capture check)
await page.waitForFunction(() => [...document.querySelectorAll("#log .k-rx")].length > 3, null, {timeout: 10000});
assert.match(await page.textContent("#log .k-rx"), /^RX FF14 ab [0-9a-f ]+\(demo\)$/);
await tool("capbox");
await page.click("#cap-btn");
await page.waitForTimeout(1500);
const capsBefore = (await caps()).length;
await E(() => link.onEvent({kind: "rx2", data: {ch: "FFF1", hex: "01 02"}, text: "RX FFF1 01 02 (notify)", raw: new Uint8Array()}));
await page.waitForTimeout(1100);
const capsNow = await caps();
assert.equal(capsNow.length, capsBefore + 1, capsNow.join(" | "));
assert.match(capsNow[0], /^A message on another channel \(FFF1\).*RX FFF1 01 02/);
await page.click("#cap-btn");
await tool("logpanel");
await page.click('label:has(#extrach)');
// remembered: a second tab (same storage) opens with both on; this tab stays connected for the checks after
const p2 = await ctx.newPage();
await p2.goto(URL + "#more"); await p2.waitForFunction(() => document.getElementById("rawrx"));
assert.deepEqual(await p2.evaluate(() => [document.getElementById("rawrx").checked, document.getElementById("extrach").checked]), [true, true]);
await p2.close();
await E(() => { document.getElementById("rawrx").click(); document.getElementById("extrach").click(); });
ok("Log: every notification as RX FF14 lines (not counted by the capture); a message on another channel gets a capture card; both switches are remembered");

// ---- Near me filters on Radio ----
await closeTool();
await page.goto(URL + "#f=90300");
await page.waitForFunction(() => view.k === 90300 && view.data, null, {timeout: 15000});
await page.click('#dossier [data-act="nearme"]');
await page.waitForSelector('#dossier select[data-act="radius"]');
assert.match(await page.textContent("#stations"), /farther than 100 km/);
ok("Near me filters in Explore (90.3 MHz, 100 km)");

// ---- Scan, and the guard on SCAN long (33: wipes the band) ----
await tab("radio");
const hold = async (loc) => { await loc.hover(); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up(); await page.waitForTimeout(200); };
// Start fresh sent 33 earlier on purpose; count only what's sent from here on
const count33 = async () => (await sent()).filter((f) => f === "ab 02 0c 33 ec").length;
const base33 = await count33();
const has33 = async () => (await count33()) > base33;
assert.equal(await page.locator('#radio-controls [data-key="SCAN"]').count(), 0);  // not in the Radio tab's controls
await page.click("#open-remote");
await page.click('#remote [data-key="SCAN"]');
assert.equal(await lastSent(), "ab 02 0c 1a d3");
await hold(page.locator('#remote [data-key="SCAN"]'));
assert.equal(await lastSent(), "ab 02 0c 1a d3");
assert.equal(await has33(), false);
ok("Scan: only in the Remote; tap and hold both send 1A, never SCAN long");
await page.click('#remote-seg label:has(input[value="keypad"])');  // Play is on the Keypad pane, which needs the full height
assert.equal(await E(() => document.getElementById("remote").dataset.detent), "large");
await hold(page.locator('#remote [data-key="PLAY"]'));
await page.waitForSelector("#ask[open]");
assert.match(await page.textContent("#ask-title"), /Hold SCAN on/);
await page.click("#ask-no"); await page.waitForTimeout(200);
assert.equal(await has33(), false);
await page.click('#remote-seg label:has(input[value="keys"])');
await hold(page.locator('#remote [data-fn="SCAN"]'));
await confirmAsk();
assert.equal(await has33(), true);
ok("Remote: Scan sends 1A; holding Play or the SCAN-slot key asks first (Cancel sends nothing, Hold SCAN sends 33)");
await page.keyboard.press("Escape");
const before = await E(() => window.sentN);
await page.keyboard.press("s"); await page.waitForTimeout(200);
assert.equal(await lastSent(), "ab 02 0c 1a d3");
await page.keyboard.press("Shift+S"); await page.waitForTimeout(200);
assert.equal(await E(() => window.sentN), before + 1);  // Shift+S ("S") isn't a shortcut: nothing more sent
ok("keyboard: s scans (1A); Shift+S sends nothing");

// ---- keyboard ----
await tab("radio");
await page.keyboard.press("r");
assert.equal(await E(() => document.getElementById("remote").open), true);
await page.keyboard.press("Escape");
await page.keyboard.press("/");
await page.waitForFunction(() => !document.getElementById("view-explore").hidden && document.activeElement.id === "q");
await settled();
ok("keyboard: r opens the Remote, / goes to the search");

// ---- Explore: reminders, the dial and the band strip, pins, Share, Discover ----
await E(() => localStorage.setItem("rf919.reminders", JSON.stringify([{k: 9580, at: Date.now() - 60000, station: "Test Radio"}])));
await page.goto("about:blank"); await page.goto(URL + "#explore");  // a fresh start (goto to another hash only routes)
assert.deepEqual(await E(() => JSON.parse(localStorage.getItem("rf919.log") || "[]")), []);  // the Demo's log is never kept
await page.waitForFunction(() => /Test Radio starts now on 9580 kHz/.test(document.getElementById("toast-text").textContent), null, {timeout: 5000});
assert.equal(await page.textContent("#toast-act"), "Look up");
assert.equal(await E(() => localStorage.getItem("rf919.reminders")), "[]");
ok("a due reminder shows a snackbar (Look up without a radio) and is spent");
await page.waitForSelector('#bands .chip[data-act="dial"]', {timeout: 15000});
await page.click('#bands .chip[data-act="dial"]:has-text("31m")');
await page.waitForFunction(() => view.k && view.data && document.querySelector(".strip"), null, {timeout: 15000});
assert.match(await page.getAttribute(".strip", "aria-valuetext"), /31m/);
assert.deepEqual(await E(() => history.state), {detail: true});
const recent0 = await E(() => localStorage.getItem("rf919.recent")), k0 = await E(() => view.k), h0 = await E(() => history.length);
await page.click('.dial-step[data-keep="dial1"]');
await page.waitForFunction((k) => view.k > k, k0);
assert.equal(await E(() => document.activeElement.dataset.keep), "dial1");
assert.equal(await E(() => localStorage.getItem("rf919.recent")), recent0);
assert.equal(await E(() => history.length), h0);
ok("a band chip opens its first frequency as a detail (a history entry); ▶ steps to the next known kHz in place, keeps the focus, leaves Recent alone");
const k1 = await E(() => view.k), fr = await page.locator(".d-dial .d-freq").boundingBox();
await page.mouse.move(fr.x + fr.width / 2 - 30, fr.y + 10); await page.mouse.down();
await page.mouse.move(fr.x + fr.width / 2 + 30, fr.y + 12, {steps: 6}); await page.mouse.up();  // 60 px: a step (120: a seek)
await page.waitForFunction((k) => view.k === k, k0);
await page.waitForTimeout(450);  // a swipe swallows the next click for 400 ms
ok("swiping the looked-up frequency right steps down, back to the first");
await page.focus(".strip"); await page.keyboard.press("End");
await page.waitForFunction(() => { const to = document.querySelector('.dial-step[data-keep="dial1"]').dataset.to; return !to || +to > 9900; });
assert.equal(await E(() => document.activeElement.dataset.keep), "strip");
const track = await page.locator(".strip-track").boundingBox();
await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2);
await page.waitForFunction(() => view.k > 9550 && view.k < 9750);
ok("the strip: End goes to the band's last known kHz; a tap in the middle jumps there");
await page.waitForFunction(() => view.data);
// 9580 carries a long schedule (11 entries in EiBi B26); Near me (on since its check) would hide some of them
await page.goto(URL + "#f=9580"); await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000});
if (await page.getAttribute('#dossier [data-act="nearme"]', "aria-pressed") === "true") await page.click('#dossier [data-act="nearme"]');
await page.waitForSelector('#dossier [data-act="sched"]');
assert.equal(await page.locator("#dossier .slots tr").count(), 4);
assert.equal(await E(() => [...document.querySelectorAll("#dossier *")].some((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))), false);
await page.click('#dossier [data-act="sched"]');
await page.waitForFunction(() => document.getElementById("tools").open && !document.getElementById("sched-pane").hidden);
assert.ok(await page.locator("#sched-body tr").count() > 4);
assert.match(await page.textContent("#tools-title"), /^Schedule · 9580 kHz/);
await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.getElementById("tools").open);
ok("the card shows 4 slots and no scrolling box; Full schedule opens all of them in the sheet");
const kp = await E(() => view.k);
await page.click('#dossier [data-act="pin"]');
assert.equal(await page.getAttribute('#dossier [data-act="pin"]', "aria-pressed"), "true");
await page.click('#dossier [data-act="share"]');
await page.waitForFunction(() => /Link copied|#f=\d+/.test(document.getElementById("toast-text").textContent));
ok("Share: no share sheet here, so the link is copied (or shown)");
await page.waitForSelector("#nearby [data-go]", {timeout: 15000});
const kNear = +await page.getAttribute("#nearby [data-go]", "data-go"), h1 = await E(() => history.length);
await page.click("#nearby [data-go]");
await page.waitForFunction((k) => view.k === k && location.hash === `#f=${k}`, kNear);
assert.equal(await E(() => history.length), h1);
ok("a Nearby card opens its frequency in place (no new history entry)");
await page.click('#tabbar [data-tab="explore"]'); await atHome();
ok("tapping Explore's tab in the detail goes back to its home");
await page.goto(URL + `#f=${kp}`); await page.reload(); await page.waitForFunction((k) => view.k === k, kp);
await page.click("#x-back"); await atHome(); await page.waitForSelector("#recent .chip.pinned");
assert.equal(+await page.getAttribute("#recent .chip:first-child", "data-look"), kp);
ok("a pin survives a reload and comes first under the search");
await page.click('#disc-meters label:has-text("75m")');
assert.match(await page.textContent("#disc-scan"), /Scan 75m · \d+/);
await page.click("#disc-scan");
await page.waitForFunction(() => /scanned/.test(document.getElementById("disc-results").textContent), null, {timeout: 60000});
await page.click('#disc-seg label:has-text("Near me")');
await page.selectOption("#disc-band", "FM");
await page.click("#disc-scan");
await page.waitForSelector("#disc-results [data-go]", {timeout: 90000});
const kn = +await page.getAttribute("#disc-results [data-go]", "data-go");
await page.click("#disc-results [data-go]");
await page.waitForFunction((k) => view.k === k && location.hash === `#f=${k}`, kn);
ok("Discover: a meter band scan; Near me FM, nearest first; a row opens its frequency");

// ---- wide screens: Explore's home and the frequency side by side ----
{
  const wide = await (await b.newContext({viewport: {width: 1280, height: 800}})).newPage();
  wide.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await wide.goto(URL + "#explore");
  await wide.waitForSelector('#bands .chip[data-act="dial"]', {timeout: 15000});
  assert.match(await wide.evaluate(() => getComputedStyle(document.getElementById("host-explore"), "::before").content), /Pick a frequency/);
  const y0 = await wide.evaluate(() => { window.scrollTo(0, 120); return window.scrollY; });
  await wide.click('#bands .chip[data-act="dial"]:has-text("31m")');
  await wide.waitForFunction(() => view.k && view.data, null, {timeout: 15000});
  assert.equal(await wide.locator("#x-home").isVisible(), true);
  assert.equal(await wide.locator("#dossier .d-freq").isVisible(), true);
  assert.equal(await wide.evaluate(() => window.scrollY), y0);  // the list kept its place
  await wide.close();
  ok("wide screens: the list and the frequency side by side; opening one keeps the list where it was");
}

console.log(`\n${n} checks passed`, "| page errors:", errors.length ? errors : "none");
await b.close();
if (errors.length) process.exit(1);
