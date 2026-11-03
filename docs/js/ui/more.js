import {DEMOD, EQ, FUNC_BUTTONS, KEYS, LONG, MAX_FRAME, REPEAT, frame, hex, pad2} from "../protocol.js";
import {fmtKHz, parseFreqInput, toKHz} from "../radiomap.js";
import {MAX_CH, MEM_BANDS, bandCount, delay, listToText, recallTestSteps, storeTestSteps, wipeTestSteps} from "../memories.js";
import {waiters} from "../state.js";
import {BleLink, ReplayLink, errText, linkOpts, sleep} from "../link.js";
import {$, ask, esc, go, handlers, log, openRemote, route, setStatus, state, toast} from "./shell.js";
import {mem, nearPasses, renderView, show, store, view} from "./radio.js";
import {addMem, addPicked, applyText, exportBackup, importBackup, memNote, nearFind, radioMemBand, readBackup, recordedIn, renderMem, renderPicks, renderSwChips, runJob, saveMem, selRows, shownBand, startFresh, storeHere, swFind} from "./memories.js";

// ---- Test one memory: fixed pauses, every step marked in the log ----
// The connection to the radio (BleLink) or the Demo (ReplayLink); set by startBle / startDemo below
export let link = null;

export function testEntry() {
  const band = $("t-band").value, k = parseFreqInput($("t-freq").value), ch = Number($("t-ch").value);
  if (k === null) { toast("Type a frequency for the test", 3000, true); return null; }
  if (!(Number.isInteger(ch) && ch >= 1 && ch <= MAX_CH)) { toast(`Type a channel, 1–${MAX_CH}`, 3000, true); return null; }
  return {band, kHz: k, ch};
}
export async function testRun(kind, auto) {
  if (!state.ok || !link) { toast("Not connected — tap Connect", 3500, true); return; }
  if (mem.run || (mem.test && mem.test.busy)) return;
  let e;
  if (kind === "wipe") {
    e = {band: $("t-band").value};
    if (!await ask({title: `Hold SCAN on ${e.band}?`, body: `On the RF919 this deletes ALL ${e.band} memories.`, ok: "Hold SCAN", danger: true})) return;
  } else if (!(e = testEntry())) return;
  const confirmKey = $("t-confirm").value, sig = [kind, e.band, e.kHz, e.ch, confirmKey].join(" ");
  if (auto || !mem.test || mem.test.sig !== sig || mem.test.i >= mem.test.steps.length) {
    mem.test = {sig, i: 0, busy: false, steps: kind === "store" ? storeTestSteps(e, confirmKey)
      : kind === "recall" ? recallTestSteps(e.band, e.ch) : wipeTestSteps(e.band)};
  }
  const t = mem.test, status = $("t-status");
  t.busy = true;
  try {
    do {
      const s = t.steps[t.i];
      memNote(`── ${kind} test, step ${t.i + 1}/${t.steps.length}: ${s.label}`);
      status.textContent = `Step ${t.i + 1}/${t.steps.length}: ${s.label}…`;
      await s.run(link, waiters);
      t.i++;
      if (auto && t.i < t.steps.length) await delay(1500);
    } while (auto && t.i < t.steps.length);
    status.textContent = t.i < t.steps.length ? `Sent step ${t.i}/${t.steps.length}. Next: ${t.steps[t.i].label}`
      : `All ${t.steps.length} steps sent. Note what the radio shows, then copy the log (Settings › Log).`;
  } catch (err) {
    status.textContent = `Step ${t.i + 1} failed: ${errText(err)}`;
    mem.test = null;
  } finally { t.busy = false; }
}

export async function clearBand() {
  const band = shownBand(), n = bandCount(mem.list, band);
  if (mem.run || !n || !await ask({title: `Clear the ${band} list?`, body: `Removes its ${n} memor${n === 1 ? "y" : "ies"} from this list. The radio keeps what it has stored.`, ok: "Clear", danger: true})) return;
  Object.assign(mem, {list: mem.list.filter((e) => e.band !== band), check: null, fail: null});
  saveMem(); renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
}

// ---- Developer: send any frame (FF13 only) ----
export function parseHexBytes(s) {
  const parts = s.trim().replace(/0x/gi, "").split(/[\s,:]+/).filter(Boolean)
    .flatMap((p) => p.length > 2 && p.length % 2 === 0 ? p.match(/../g) : [p]);
  return parts.every((p) => /^[0-9a-f]{1,2}$/i.test(p)) ? parts.map((p) => parseInt(p, 16)) : null;
}
export function devFrame() {
  const c = parseHexBytes($("dev-cmd").value), d = parseHexBytes($("dev-data").value);
  return c && c.length === 1 && d && d.length <= MAX_FRAME - 4 ? frame(c[0], d) : null;
}
export function renderDev() {
  const f = devFrame();
  $("dev-frame").textContent = f ? `Frame: ${hex(f)}` : "Command: one byte. Data: up to 16 bytes. Both in hex.";
  $("dev-send").disabled = !f;
}

// ---- Key capture: what the radio reports when one of its own buttons is pressed (informational; sends nothing) ----
// The RF919 doesn't send key codes: a press shows only as what changed (a frequency, channel mode, a setting…).
// Every decoded event updates capture.last (the radio's state as last reported), so the periodic state dump, which
// repeats it, counts as nothing new. Changes arriving within 0.7 s of each other are one press.
const CAP_SKIP = new Set(["rssi_snr", "battery", "sleep", "debug", "link", "partial", "track_time", "rx"]);
export const capture = {on: false, last: new Map(), group: null, timer: 0};
const capKey = (ev) => {
  const d = ev.data || {}, id = d.name ?? d.slot ?? d.button ?? d.row;
  return id === undefined ? ev.kind : `${ev.kind}:${id}`;
};
const capValue = (ev) => ev.kind === "field" ? ev.data.value.trim() : JSON.stringify(ev.data);

export function captureFeed(ev) {
  if (CAP_SKIP.has(ev.kind) || (ev.kind === "field" && /^(snr|rssi)$/.test(ev.data.name))) return;
  const key = capKey(ev), value = capValue(ev), old = capture.last.get(key);
  capture.last.set(key, value);
  const news = old !== value || ev.kind === "unknown" || ev.kind === "toast";
  if (!capture.on || !news) return;
  const g = capture.group ??= {t: new Date(), items: []};
  g.items.push({ev, old});
  clearTimeout(capture.timer);
  capture.timer = setTimeout(closeCapture, 700);
  $("cap-field").textContent = "Reading the radio…";
}

// "STEP: 2.50K → 5K" from the radio's text lines ("VOL:4  STEP:2.50K  DE-EMP:50US  ATT:DX  MONO")
function fieldChange(name, old, now) {
  if ((name === "field11" || name === "field12") && old != null) {
    const tok = (t) => t.split(/\s{2,}/).filter(Boolean), key = (t) => t.includes(":") ? t.split(":")[0] : null;
    const before = tok(old), out = [];
    tok(now).forEach((t, i) => {
      const k = key(t), o = k ? before.find((x) => key(x) === k) : before[i];
      if (o === t) return;
      out.push(k ? `${k}: ${o ? o.slice(k.length + 1) : "?"} → ${t.slice(k.length + 1)}` : `${o ?? "?"} → ${t}`);
    });
    if (out.length) return out.join(", ");
  }
  const label = {field9: "Squelch", field10: "Squelch", demod: "Demodulation", bw: "Bandwidth", rec: "Recording", volume: "Volume"}[name] || name;
  return `${label}: ${old != null ? `${old} → ` : ""}${now}`;
}

// A guess at the button from what changed, and the changes in words
function describe(items) {
  const freqs = items.filter((i) => i.ev.kind === "freq" && !i.ev.data.alert);
  const prev = freqs.length && freqs[0].old ? JSON.parse(freqs[0].old) : null, now = freqs.length ? freqs[freqs.length - 1].ev.data : null;
  const lines = [], has = (k) => items.find((i) => i.ev.kind === k);
  for (const {ev, old} of items) {
    const d = ev.data;
    if (ev.kind === "freq") continue;  // summed up below
    lines.push(
      ev.kind === "preset" ? (d.state === 1 ? `Channel mode on: CH ${d.n}` : d.state === 2 ? `Channel number blinking: CH ${d.n}` : d.state === 3 ? "Channel: - -" : "Channel mode off") :
      ev.kind === "field" ? fieldChange(d.name, old, d.value.trim()) :
      ev.kind === "volume" ? `Volume ${d.volume}` :
      ev.kind === "mode" ? `Mode: ${d.mode}` :
      ev.kind === "demod" ? `Demodulation ${d.demod}, bandwidth ${d.bw}` :
      ev.kind === "entry" ? `Keypad entry: ${d.text}` :
      ev.kind === "toast" ? `The radio says: ${d.text.trim()}` :
      ev.kind === "unknown" ? `A message this app doesn't know (cmd ${pad2(d.cmd.toString(16))})` : ev.text);
  }
  const bandChange = prev && now && prev.band !== now.band, moved = freqs.length;
  if (moved) {
    const step = prev && !bandChange ? toKHz(now) - toKHz(prev) : null;
    lines.unshift(bandChange ? `Band: ${prev.band} → ${now.band}` :
      moved >= 3 ? `Frequency moving: ${moved} changes, now ${fmtKHz(toKHz(now))}` :
      `Frequency ${prev ? fmtKHz(toKHz(prev)) : "?"} → ${fmtKHz(toKHz(now))}${step ? ` (${step > 0 ? "+" : ""}${step} kHz)` : ""}`);
  }
  const p = has("preset"), field = items.find((i) => i.ev.kind === "field");
  const title =
    has("rx2") ? `A message on another channel (${has("rx2").ev.data.ch})` :
    has("unknown") ? "Unknown message: perhaps the key itself" :
    bandChange ? "Band" :
    p && p.ev.data.state === 2 ? "Memo held: store mode" :
    p && p.ev.data.state === 1 ? "Memo (Preset): channel mode on" :
    p && p.ev.data.state === 0 ? "Memo: channel mode off" :
    moved >= 3 ? "Scan or seek: the frequency is moving" :
    has("entry") ? "Keypad / FREQ" :
    moved ? "Tuning: ◀ ▶ or the knob" :
    has("volume") ? "Volume" :
    has("mode") ? "Mode (radio, music, Bluetooth…)" :
    has("demod") ? "Demodulation / bandwidth" :
    field ? `A setting: ${fieldChange(field.ev.data.name, field.old, field.ev.data.value.trim())}` :
    has("toast") ? "A message on the radio" : "Something changed";
  return {title, lines};
}

function closeCapture() {
  const g = capture.group;
  capture.group = null;
  if (!g) return;
  const {title, lines} = describe(g.items);
  const li = document.createElement("li");
  li.className = "cap";
  li.innerHTML = `<div class="cap-head"><b>${esc(title)}</b><time>${g.t.toTimeString().slice(0, 8)}</time></div>` +
    (lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "") +
    `<pre>${esc(g.items.map((i) => hex(i.ev.raw)).join("\n"))}</pre>`;
  $("cap-list").prepend(li);
  while ($("cap-list").childElementCount > 12) $("cap-list").lastElementChild.remove();
  memNote(`── key capture: ${title}`);
  renderCapture();
}

export function renderCapture() {
  const f = $("cap-field");
  f.classList.toggle("on", capture.on);
  f.textContent = !capture.on ? "Off" : state.ok ? "Press a button on the radio…" : "Connect the radio, then press one of its buttons…";
  $("cap-btn").textContent = capture.on ? "Stop" : "Capture";
  $("cap-btn").className = `small ${capture.on ? "danger" : "primary"}`;
}

export function debug(text) { log({kind: "debug", text, raw: new Uint8Array()}); }
export function hasGbk() { try { new TextDecoder("gbk"); return true; } catch { return false; } }

export function onEvent(ev) {
  waiters.feed(ev);
  captureFeed(ev);  // before the handlers, which update the page's state
  const h = handlers[ev.kind];
  if (h) h(ev.data);
  log(ev);
}

export async function send(fn) {
  try { await fn(); }
  catch (e) { toast(e.message === "not connected" ? "Not connected — tap Connect" : `Error: ${e.message || e}`, 3500, true); }
}

export function pressKey(key, long) {
  if (state.hold) { long = true; toggleHold(false); }
  const k = long && LONG[key] !== undefined ? LONG[key] : key;
  if ((typeof k === "number" ? k : KEYS[k]) === KEYS.PLAY_LONG) { holdScan(); return; }
  if (navigator.vibrate) navigator.vibrate(long ? 40 : 15);
  send(() => link ? link.press(k) : Promise.reject(new Error("not connected")));
}
// Holding SCAN/ATS (33) deletes every memory of the band on the RF919 (user report): never without asking.
// Reached by holding Play or the radio's SCAN-slot key (V-UHF), or with Hold next key; the Scan buttons never send it
async function holdScan() {
  const band = waiters.freq ? waiters.freq.band : "the current band";
  if (!await ask({title: `Hold SCAN on ${band}?`, body: `On the RF919 this deletes every ${band} memory, and can't be undone. ` +
    "Memories › Start fresh does the same and also clears this app's list and record.", ok: "Hold SCAN", danger: true})) return;
  if (navigator.vibrate) navigator.vibrate(40);
  send(() => link ? link.press("PLAY_LONG") : Promise.reject(new Error("not connected")));
}

export function toggleHold(on = !state.hold) { state.hold = on; $("hold").checked = on; }

// Short tap = key, hold ≥ 600 ms = long-press variant
export function bindPress(btn, keyOf) {
  let timer = null, fired = false;
  const clear = () => { clearTimeout(timer); timer = null; btn.classList.remove("pressing"); };
  btn.addEventListener("pointerdown", (e) => {
    if (btn.disabled || e.button > 0) return;
    fired = false; btn.classList.add("pressing");
    timer = setTimeout(() => {
      fired = true; clear(); btn.classList.add("long-fired");
      setTimeout(() => btn.classList.remove("long-fired"), 250);
      pressKey(keyOf(), true);
    }, 600);
  });
  btn.addEventListener("pointerup", () => { if (timer && !fired) { clear(); pressKey(keyOf(), false); } else clear(); });
  btn.addEventListener("pointerleave", clear);
  btn.addEventListener("pointercancel", clear);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pressKey(keyOf(), false); } });
}

export async function doTune() {
  const v = $("freqin").value.trim();
  if (!v) return;
  $("freqin").blur();
  await send(() => link.typeFreq(v));
  $("freqin").value = "";
}

export async function startBle() {
  if (!(link instanceof BleLink)) { if (link) await link.close(); link = new BleLink(onEvent, setStatus); }
  // Default: list every device, since some browsers (Bluefy) don't match the name filter
  try { await link.connect(!$("onlyRadio").checked); }
  catch (e) {
    if (e.name === "NotFoundError") {
      setStatus("bad", "no device chosen");
      if ($("onlyRadio").checked) toast("Radio not in the list? Turn off \"Only list RF919 radios\" in More › Connection", 6000);
    }
    else { setStatus("bad", `failed: ${errText(e)}`); $("logpanel").open = true; go("more"); }
  }
}
export async function startDemo() {
  if (link) await link.close();
  link = new ReplayLink(onEvent, setStatus);
  link.connect();
}

// Screen wake lock
// quiet: no error toast (a run asks for it in passing)
export async function setWake(on, quiet = false) {
  try {
    if (on) { state.wake = await navigator.wakeLock.request("screen"); state.wake.addEventListener("release", () => { if (!document.hidden) syncWake(false); }); }
    else if (state.wake) { await state.wake.release(); state.wake = null; }
    syncWake(on);
  } catch (e) { if (!quiet) toast("Keep-screen-on isn't available here", 3500, true); syncWake(false); }
}
export const syncWake = (on) => { $("wake").checked = on; };

// Keyboard: / search, r Remote, and the radio's keys (typing digits searches while no radio is connected)
export const SHORTCUTS = {ArrowLeft: "DOWN", ArrowRight: "UP", "+": "VOL+", "=": "VOL+", "-": "VOL-", b: "BAND", s: "SCAN", p: "POWER", m: "MEMO",
  ".": "POINT", Enter: "FREQ", Backspace: "BACK"};

// What ran at load in the single-script page, in the same order; app.js calls it once every module is loaded
export function init() {
  // Native controls in the Memories view: the band segmented control and the meter-band checkboxes
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "memband") { mem.viewBand = t.value; renderMem(); }
    else if (t.matches("[data-swband]")) {
      if (t.checked) mem.swSel.add(t.value); else mem.swSel.delete(t.value);
      store.set("rf919.swbands", [...mem.swSel]);
    }
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mem]");
    if (!t || t.disabled) return;
    switch (t.dataset.mem) {
      case "del": {
        if (mem.run) return;
        const i = +t.dataset.i;
        mem.list = mem.list.filter((_, j) => j !== i);
        saveMem(); renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
        break;
      }
      case "clear": clearBand(); break;
      case "show-text": $("mem-text").value = listToText(selRows()); $("mem-errs").textContent = ""; break;
      case "apply": applyText(true); break;
      case "append": applyText(false); break;
      case "sw-find": swFind(); break;
      case "near-find": nearFind(); break;
      case "job-stop": if (mem.job) mem.job.abort(); break;
      case "add-sw": addPicked("sw"); break;
      case "add-near": addPicked("near"); break;
      case "store": runJob("store"); break;
      case "check": runJob("check"); break;
      case "resume": if (mem.fail) runJob(mem.fail.kind, mem.fail.i); break;
      case "fresh": startFresh(); break;
      case "bk-share": exportBackup(true); break;
      case "bk-download": exportBackup(false); break;
      case "bk-open": $("backup-file").click(); break;
      case "bk-load": importBackup(false); break;
      case "bk-mark": importBackup(true); break;
      case "t-wipe": testRun("wipe", true); break;
      case "stop": if (mem.run) mem.run.stop(); break;
      case "t-step": testRun("store", false); break;
      case "t-auto": testRun("store", true); break;
      case "t-recall": testRun("recall", true); break;
    }
  });
  for (const b of MEM_BANDS) $("t-band").add(new Option(b, b, b === "SW", b === "SW"));
  renderSwChips();
  $("mem-text").addEventListener("input", () => { $("mem-errs").textContent = ""; });
  $("backup-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";  // so the same file can be opened again
    if (f) readBackup(f);
  });
  $("dev-cmd").addEventListener("input", renderDev);
  $("dev-data").addEventListener("input", renderDev);
  $("dev-send").addEventListener("click", () => {
    const f = devFrame();
    if (!f) return;
    memNote(`── developer: send ${hex(f)}`);
    send(() => link ? link.send(f) : Promise.reject(new Error("not connected")));
  });
  linkOpts.rawRx = $("rawrx").checked = !!store.get("rf919.rawrx", false);
  linkOpts.extra = $("extrach").checked = !!store.get("rf919.extrach", false);
  $("rawrx").addEventListener("change", (e) => { linkOpts.rawRx = e.target.checked; store.set("rf919.rawrx", e.target.checked); });
  $("extrach").addEventListener("change", (e) => {
    linkOpts.extra = e.target.checked;
    store.set("rf919.extrach", e.target.checked);
    if (e.target.checked && link instanceof BleLink && link.device && !link.extraGranted) toast("Now Disconnect, then Connect, to listen on FFF1 and battery", 6000);
  });
  $("cap-btn").addEventListener("click", () => {
    capture.on = !capture.on;
    if (!capture.on) { clearTimeout(capture.timer); closeCapture(); }
    renderCapture();
  });
  $("cap-clear").addEventListener("click", () => { $("cap-list").textContent = ""; });
  renderCapture();

  document.querySelectorAll("[data-key]").forEach(b => bindPress(b, () => b.dataset.key));
  document.querySelectorAll("[data-fn]").forEach(b => bindPress(b, () => FUNC_BUTTONS[b.dataset.fn]));
  $("tunebtn").addEventListener("click", doTune);
  $("freqin").addEventListener("keydown", (e) => { if (e.key === "Enter") doTune(); });
  $("settime").addEventListener("click", () => send(async () => { await link.setTime(); toast("Clock synced"); }));
  $("hold").addEventListener("change", () => toggleHold($("hold").checked));
  $("rawlog").addEventListener("change", (e) => state.raw = e.target.checked);

  $("copylog").addEventListener("click", async () => {
    const text = [...$("log").children].map(d => d.textContent).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Log copied"); }
    catch {  // older iOS webviews: select the text so it can be copied by hand
      getSelection().selectAllChildren($("log")); toast("Select-all done: tap Copy");
    }
  });
  $("connect").addEventListener("click", startBle);
  $("storehere").addEventListener("click", storeHere);
  $("disconnect").addEventListener("click", () => link && link.close(true));
  $("demo").addEventListener("click", startDemo);
  $("wake").addEventListener("change", () => setWake($("wake").checked));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && $("wake").checked) setWake(true); });
  if (!("wakeLock" in navigator)) $("wake").disabled = true;
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches("button") && (e.key === "Enter" || e.key === " ")) return;
    if (document.querySelector("dialog.ask[open]")) return;
    if (e.key === "/") { e.preventDefault(); go("explore"); $("q").focus(); return; }
    if (e.key === "r" && !$("remote").open) { e.preventDefault(); openRemote(); return; }
    if (!state.ok && /^[0-9.]$/.test(e.key)) { e.preventDefault(); go("explore"); $("q").focus(); $("q").value += e.key; return; }
    const key = /^[0-9]$/.test(e.key) ? e.key : SHORTCUTS[e.key];
    if (key) { e.preventDefault(); pressKey(key, e.shiftKey); }
  });

  if (!navigator.bluetooth) $("nobt").hidden = false;
  setStatus("bad", navigator.bluetooth ? "not connected" : "no Web Bluetooth");
  debug(`page ${document.lastModified} · ${navigator.userAgent}`);
  debug(`secure context: ${window.isSecureContext} · Web Bluetooth: ${!!navigator.bluetooth}` +
    ` · requestDevice: ${typeof navigator.bluetooth?.requestDevice} · GBK decoder: ${hasGbk()}`);
  if (navigator.bluetooth?.getAvailability) {
    navigator.bluetooth.getAvailability().then(a => debug(`Bluetooth adapter available: ${a}`), e => debug(`getAvailability failed: ${errText(e)}`));
  }
  route();
  if (new URLSearchParams(location.search).has("demo")) startDemo();

  // The page's state and a few helpers, on window as the single-script page had them: for the browser checks
  // and for poking around in the console. link is a getter, since the page replaces it on Connect/Demo
  Object.assign(window, {state, view, mem, waiters, capture, frame, toKHz, KEYS, addMem, renderMem, shownBand, radioMemBand, nearPasses, go, ask});
  Object.defineProperty(window, "link", {get: () => link, configurable: true});
}
