import {BAND_CODES, hex, pad2, splitFreq} from "../protocol.js";
import {fmtKHz, span, toKHz} from "../radiomap.js";
import {memKey} from "../memories.js";
import {waiters} from "../state.js";
import {BleLink, sleep} from "../link.js";
import {swipeTune, swipeUp, swipeToClose} from "./gestures.js";
import {following, mem, radioFreq, renderView, show, store, view} from "./radio.js";
import {renderMem, renderStoreHere} from "./memories.js";
import {link, pressKey, send} from "./more.js";

// ---- UI ----
export const $ = (id) => document.getElementById(id);
export const BAND_COLORS = {FM:"#4fc3f7", AM:"#ffb74d", SW:"#81c784", LW:"#ce93d8", AIR:"#90caf9", WB:"#ef5350",
  HAM:"#fff176", CB:"#a1887f", VHF:"#4db6ac", UHF:"#9575cd"};
export const state = {mode: "", battery: "", sleep: "", alarm: "", fields: {}, hold: false, raw: false, wake: null, ok: false};

export function setStatus(kind, text) {
  document.querySelectorAll("[data-lamp]").forEach((l) => { l.className = "lamp " + kind; });
  state.link = text;
  state.ok = kind === "ok";
  renderStat();
  $("conn-state").textContent = text.charAt(0).toUpperCase() + text.slice(1);
  $("connect").textContent = kind === "ok" ? "Connected" : (link instanceof BleLink && link.device ? "Reconnect" : "Connect");
  $("connect").disabled = kind === "ok" || kind === "busy" || !navigator.bluetooth;
  log({kind: "link", text: "● " + text, raw: new Uint8Array()});
  if (!state.ok) { waiters.freq = null; if (mem.run) mem.run.stop("the connection dropped"); }
  renderView();
  renderMem();
}

export function renderStat() {
  const parts = [esc(state.link || "")];
  if (state.mode) parts.push(`▶ <b>${esc(state.mode)}</b>`);
  if (state.battery) parts.push(state.battery);
  if (state.sleep) parts.push(`☾ ${state.sleep}`);
  if (state.alarm) parts.push(`⏰ ${state.alarm}`);
  $("stat").innerHTML = parts.join(" · ");
}

export const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
export let toastTimer;
export function toast(text, ms = 3500, err = false) {
  // Inside an open dialog the page below is out of the top layer, so the toast moves into the dialog
  const t = $("toast"), host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  if (t.parentElement !== host) host.append(t);
  t.textContent = text; t.hidden = false; t.classList.toggle("err", err);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

export function log(ev) {
  const box = $("log");
  const line = document.createElement("div");
  const time = new Date().toTimeString().slice(0, 8);
  const body = state.raw && ev.raw && ev.raw.length ? hex(ev.raw) : ev.text;
  line.innerHTML = `<span class="t">${time}</span> <span class="k-${ev.kind}">${esc(body)}</span>`;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.appendChild(line);
  while (box.childElementCount > 400) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
}

export function setBlink(el, on) { if (el) el.classList.toggle("blink", !!on); }
export function cell(name, label, value) {
  const c = $("c-" + name);
  if (label !== undefined) c.querySelector(".l").textContent = label || " ";
  if (value !== undefined) c.querySelector(".v").textContent = value || "–";
}

export const handlers = {
  freq(d) {
    const band = $("band");
    band.textContent = d.band;
    band.style.setProperty("--band", BAND_COLORS[d.band] || "#b0bec5");
    if (d.alert) { $("alert").textContent = "⚠ WEATHER ALERT"; setBlink($("alert"), true); radioFreq(null); return; }
    $("alert").textContent = ""; setBlink($("alert"), false);
    const [main, small] = d.raw ? splitFreq(d.raw, d.dp) : ["---.---", ""];
    $("freq").textContent = main;
    $("small").textContent = small;
    $("unit").textContent = d.unit;
    setBlink($("freqbox"), d.state === 2);
    view.unit = d.unit;
    renderMini(d);
    radioFreq(toKHz(d));
    renderStoreHere(d);
  },
  field(d) {
    const v = d.value.trim();
    state.fields[d.name] = v;
    const base = d.name.replace(/_label$/, "");
    if (["demod", "bw", "snr", "rssi"].includes(base)) {
      d.name.endsWith("_label") ? cell(base, v) : cell(base, undefined, v);
    } else if (d.name === "field9") cell("field9", v);
    else if (d.name === "field10") cell("field9", undefined, v);
    else if (d.name === "field11" || d.name === "field12") $(d.name).textContent = d.value;
    else if (d.name === "rec") statusLine();
  },
  button_label(d) {
    const btn = document.querySelector(`[data-fn="${d.name}"]`);
    if (btn) btn.textContent = d.value.trim() || d.name;
  },
  buttons_enabled(d) {
    for (const [name, en] of Object.entries(d)) { const b = document.querySelector(`[data-fn="${name}"]`); if (b) b.disabled = !en; }
  },
  blink(d) {
    const base = d.name.replace(/_label$/, "");
    const el = ["demod", "bw", "snr", "rssi"].includes(base) ? $("c-" + base)
             : d.name === "field9" || d.name === "field10" ? $("c-field9") : $(d.name);
    setBlink(el, d.blink);
  },
  button_blink(d) { setBlink(document.querySelector(`[data-fn="${d.button}"]`), d.blink); },
  mode(d) { state.mode = d.mode; renderStat(); },
  battery(d) {
    const color = ["var(--warn)", "var(--amber)", "var(--cool)", "var(--cool)"][Math.min(d.level, 3)];
    state.battery = `<span style="color:${color}">${"▮".repeat(d.level)}${"▯".repeat(Math.max(0, 3 - d.level))}</span>${d.charging ? " ⚡" : ""}`;
    renderStat();
  },
  sleep(d) { state.sleep = d.minutes ? `${d.minutes}m` : ""; renderStat(); },
  alarm(d) { state.alarm = d.state ? `${pad2(d.hour)}:${pad2(d.minute)}` : ""; renderStat(); },
  bands(d) { state.bands = d.bands; fillBandSelects(); },
  preset(d) {
    const t = ({1: `PRESET ${d.n}`, 2: `PRESET ${d.n}`, 3: "PRESET - -"})[d.state] || "";
    // The radio can't show names; the phone shows the one this app stored on that channel
    const r = (d.state === 1 || d.state === 2) && waiters.freq && mem.record[memKey(waiters.freq.band, d.n)];
    $("preset").textContent = r && r.name ? `${t} · ${r.name}` : t;
    renderMini();
  },
  status_text(d) { state.fields.msg = d.text; statusLine(); },
  toast(d) { toast(d.text); },
  version(d) { toast(d.text.trim(), 6000); },
  disconnect_req() { link && link.close(); },
};

export function statusLine() {
  $("statusline").textContent = [state.fields.msg, state.fields.rec].filter(Boolean).join("   ");
}

// ---- views: Radio follows the dial, Explore looks up any frequency; both show the same info panels ----
export const VIEWS = ["radio", "explore", "memories", "more"];
export let current = null;
export function go(name, {focus = true} = {}) {
  if (!VIEWS.includes(name)) name = "radio";
  const changed = current !== name;
  current = name;
  if (name === "radio" || name === "explore") {
    const host = $(`host-${name}`);
    if ($("info").parentElement !== host) host.append($("info"));
  }
  if (name === "radio" && !view.follow) followRadio();
  if (name === "explore" && view.follow) exploreMode();
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll("#tabbar [data-tab]").forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // The radio bar shows on every view but Radio, which has the full readout
  $("radiobar").hidden = name === "radio";
  document.body.classList.toggle("with-radiobar", name !== "radio");
  store.set("rf919.view", name);
  setHash(name === "explore" && view.k !== null ? view.k : name);
  if (changed) {
    window.scrollTo(0, 0);
    if (focus) $(`t-${name}`).focus({preventScroll: true});
  }
}
export function followRadio() {
  if (!view.follow) view.exploreK = view.k;
  view.follow = true;
  if (view.radioK !== null && view.radioK !== view.k) show(view.radioK);
  else if (view.radioK === null) { Object.assign(view, {k: null, data: null, err: null, near: []}); renderView(); }
  else renderView();
}
export function exploreMode() {
  view.follow = false;
  const k = view.exploreK ?? null;
  if (k !== null && k !== view.k) show(k);
  else if (k === null) { Object.assign(view, {k: null, data: null, err: null, near: []}); renderView(); }
  else renderView();
}
// A search, a shared link, an example, or a nearby row in Explore
export function lookUp(k) {
  view.follow = false;
  view.exploreK = k;
  if (current !== "explore") go("explore");
  setHash(k);
  if (k !== view.k) show(k);
  else renderView();
}
export function route() {
  const k = fromHash(), h = location.hash.slice(1);
  if (k) lookUp(k);
  else go(VIEWS.includes(h) ? h : store.get("rf919.view", "radio"), {focus: false});
}
// Nearby rows "go there": tune the radio while following it, otherwise just look
export function goTo(k) { if (following()) tuneKHz(k); else lookUp(k); }
export function tuneHere() {
  tuneKHz(view.k);
  view.exploreK = view.k;
  go("radio");
}
// Type the frequency on the radio's keypad, in the unit its current band shows
export function tuneKHz(k) {
  const text = view.unit === "MHz" ? String(k / 1000) : String(k);
  toast(`Tuning ${fmtKHz(k)}…`, 2000);
  send(() => link ? link.typeFreq(text) : Promise.reject(new Error("not connected")));
}

// A number: the frequency looked up (#f=9580); a string: a view (#memories)
export function setHash(k) {
  const h = typeof k === "number" ? `#f=${k}` : k ? `#${k}` : "";
  if (location.hash === h) return;
  try { history.replaceState(null, "", h || location.pathname + location.search); } catch { /* sandboxed */ }
}
export function fromHash() {
  const m = location.hash.match(/^#f=(\d{1,7})$/);
  return m && +m[1] > 0 ? +m[1] : null;
}

// ---- the Remote: a native <dialog> (focus trap, Esc, backdrop and focus return come with it) ----
export function openRemote() { if (!$("remote").open) $("remote").showModal(); }
export function closeRemote() { if ($("remote").open) $("remote").close(); }

// ---- band pickers: native <select>s (the phone's own picker); command 10 with frequency 0 switches band ----
export const BAND_LIST = ["FM", "AM", "SW", "AIR", "CB", "UHF", "WB", "VHF", "LW"];
export function fillBandSelects() {
  const bands = (state.bands && state.bands.length ? state.bands : BAND_LIST).filter((b) => b in BAND_CODES);
  const cur = waiters.freq && waiters.freq.band;
  document.querySelectorAll("[data-band-select]").forEach((sel) => {
    sel.innerHTML = bands.map((b) => `<option value="${b}">${b}</option>`).join("");
    sel.value = cur && bands.includes(cur) ? cur : "";
  });
}
// The radio's band and frequency wherever they show besides the readout: the radio bar, the Remote, the pickers
export function renderMini(d = waiters.freq) {
  const text = !d ? "---.---" : d.alert ? "ALERT" : d.raw ? splitFreq(d.raw, d.dp)[0] : "---.---";  // the big digits only
  document.querySelectorAll("[data-freq]").forEach((e) => { e.textContent = text; });
  if (d) document.querySelectorAll("[data-band-chip]").forEach((e) => { e.textContent = d.band; e.style.setProperty("--band", BAND_COLORS[d.band] || "#b0bec5"); });
  document.querySelectorAll("[data-band-select]").forEach((sel) => { if (d && [...sel.options].some((o) => o.value === d.band)) sel.value = d.band; });
  const sub = [d && !d.alert && d.unit, $("preset").textContent].filter(Boolean).join(" · ");
  document.querySelectorAll("[data-sub]").forEach((e) => { e.textContent = sub; });
}

// ---- ask(): a confirmation with clear verbs, in a native <dialog>. Resolves true for the confirm button ----
export function ask({title, body = "", ok = "OK", cancel = "Cancel", danger = false}) {
  const d = $("ask");
  $("ask-title").textContent = title;
  $("ask-body").textContent = body;
  $("ask-body").hidden = !body;
  $("ask-ok").textContent = ok;
  $("ask-no").textContent = cancel;
  $("ask-ok").className = danger ? "danger" : "primary";
  d.returnValue = "";
  return new Promise((resolve) => {
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), {once: true});
    d.showModal();
    $(danger ? "ask-no" : "ask-ok").focus();
  });
}

// What ran at load in the single-script page, in the same order; app.js calls it once every module is loaded
export function init() {
  handlers.entry = handlers.freq;
  $("remote").addEventListener("click", (e) => { if (e.target === $("remote") || e.target.closest("[data-close]")) closeRemote(); });
  $("open-remote").addEventListener("click", openRemote);
  $("rb-open").addEventListener("click", openRemote);

  // Gestures (each also has a button): swipe a frequency to step or seek, swipe the radio bar up for the Remote,
  // drag the Remote down by its top to close it
  // The readout's hint goes once the swipe has been found
  $("swipe-hint").hidden = store.get("rf919.swiped", false);
  document.querySelectorAll("[data-swipe-tune]").forEach((el) => swipeTune(el, (dir, seek) => {
    if (!state.ok) return;
    pressKey(dir > 0 ? "UP" : "DOWN", seek);
    if (!$("swipe-hint").hidden) { $("swipe-hint").hidden = true; store.set("rf919.swiped", true); }
  }));
  swipeUp($("rb-open"), openRemote);
  swipeToClose($("remote"), [$("remote-grab"), $("remote").querySelector(".sheet-head")], closeRemote);
  document.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-band-select]");
    if (!sel || !sel.value) return;
    if (navigator.vibrate) navigator.vibrate(15);
    send(() => link ? link.tune(sel.value, 0) : Promise.reject(new Error("not connected")));
  });
  fillBandSelects();
}
