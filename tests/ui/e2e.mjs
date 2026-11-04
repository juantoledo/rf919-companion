// End-to-end checks of the web app in its Demo (the simulated radio): tabs and links, the Remote, gestures,
// band pickers, memories (store, check, Store here, clear, Start fresh), backup, switches, key capture, Near me, Explore (dial, strip, pins, Share, Discover, reminders),
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
const tab = (t) => page.click(`#tabbar [data-tab="${t}"]`);
// The tools of Memories and More open in one sheet; a modal sheet has to close before the page behind takes taps
const toolsOpen = () => E(() => document.getElementById("tools").open);
const closeTool = async () => { if (await toolsOpen()) { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.getElementById("tools").open); } };
const tool = async (id) => { await closeTool(); await page.click(`[data-tool="${id}"]`); await page.waitForFunction(() => document.getElementById("tools").open); };
const mode = () => E(() => document.getElementById("view-explore").dataset.mode);
const atHome = () => page.waitForFunction(() => location.hash === "#explore" && document.getElementById("view-explore").dataset.mode === "home");
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
for (const s of ["#search", "#bands", "#discover"]) { const r = await page.locator(s).boundingBox(); assert.ok(r && r.y < fold, `${s} at ${r && r.y}`); }
assert.equal(await page.locator("#radiobar").isVisible(), true);
assert.equal(await page.locator("#radiobar .rb-off").isVisible(), true);
{ const r = await page.locator("#radiobar").boundingBox(); assert.ok(r.width < 260, `idle mini player ${r.width}px wide`); }
ok("Explore home: search, bands and Discover above the fold; with no radio the mini player is a pill (Connect radio · Demo)");
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
await page.click('#recent [data-look="9580"]'); await page.waitForFunction(() => view.k === 9580 && view.data, null, {timeout: 15000});
await page.click("#x-back"); await atHome();
ok("the bar's ← does the same");
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
assert.equal(await page.locator('#dossier [data-act="tunehere"]').isVisible(), true);
assert.equal(await page.locator("#radio-controls").isHidden(), true);
await tab("radio");
await page.waitForFunction(() => view.k === 11620 && view.data, null, {timeout: 15000});
assert.equal(await page.locator("#readout").isVisible(), true);
ok("Explore hides the readout and controls while connected and shows the looked-up frequency; back on Radio they return");

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
await page.keyboard.press("Escape");
assert.equal(await E(() => document.getElementById("remote").open), false);
assert.equal(await E(() => document.activeElement.id), "open-remote");
ok("Keys opens the Remote; Esc closes it and focus returns");
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
const sentBefore = (await sent()).length;
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
assert.equal((await sent()).length, sentBefore);  // the capture never sends anything
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
const before = (await sent()).length;
await page.keyboard.press("s"); await page.waitForTimeout(200);
assert.equal(await lastSent(), "ab 02 0c 1a d3");
await page.keyboard.press("Shift+S"); await page.waitForTimeout(200);
assert.equal((await sent()).length, before + 1);  // Shift+S ("S") isn't a shortcut: nothing more sent
ok("keyboard: s scans (1A); Shift+S sends nothing");

// ---- keyboard ----
await tab("radio");
await page.keyboard.press("r");
assert.equal(await E(() => document.getElementById("remote").open), true);
await page.keyboard.press("Escape");
await page.keyboard.press("/");
assert.equal(await visibleView(), "explore");
assert.equal(await E(() => document.activeElement.id), "q");
ok("keyboard: r opens the Remote, / goes to the search");

// ---- Explore: reminders, the dial and the band strip, pins, Share, Discover ----
await E(() => localStorage.setItem("rf919.reminders", JSON.stringify([{k: 9580, at: Date.now() - 60000, station: "Test Radio"}])));
await page.goto("about:blank"); await page.goto(URL + "#explore");  // a fresh start (goto to another hash only routes)
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

console.log(`\n${n} checks passed`, "| page errors:", errors.length ? errors : "none");
await b.close();
if (errors.length) process.exit(1);
