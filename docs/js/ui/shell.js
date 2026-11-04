import {BAND_CODES, hex, pad2, splitFreq} from "../protocol.js";
import {fmtKHz, span, toKHz} from "../radiomap.js";
import {memKey} from "../memories.js";
import {waiters} from "../state.js";
import {BleLink, sleep} from "../link.js";
import {SIDE_SHEETS, sheetDrag, swipeAway, swipeTune, swipeUp} from "./gestures.js";
import {addRecent, following, loadIndex, mem, radioFreq, renderView, show, store, view} from "./radio.js";
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
// A snackbar; action: {label, run} adds one button (Undo), and keeps it up a little longer
export function toast(text, ms = 3500, err = false, action = null) {
  // Inside an open dialog the page below is out of the top layer, so the toast moves into the dialog
  const t = $("toast"), host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  if (t.parentElement !== host) host.append(t);
  $("toast-text").textContent = text; t.hidden = false; t.classList.toggle("err", err);
  const act = $("toast-act");
  act.hidden = !action;
  t.classList.toggle("has-act", !!action);
  act.onclick = action ? () => { t.hidden = true; action.run(); } : null;
  act.textContent = action ? action.label : "";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, action ? Math.max(ms, 5000) : ms);
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
const scrollMem = {};  // each tab comes back where it was left
export function go(name, {focus = true} = {}) {
  if (!VIEWS.includes(name)) name = "radio";
  const prev = current, changed = prev !== name;
  if (changed && prev) scrollMem[prev] = window.scrollY;
  if (name === "explore") exploreScreen(view.exploreK != null);  // Explore comes back on the screen it was left on
  current = name;
  if (name === "radio" || name === "explore") {
    const host = $(`host-${name}`);
    if ($("info").parentElement !== host) host.append($("info"));
  }
  if (name === "radio" && !view.follow) followRadio();
  if (name === "explore" && view.follow) exploreMode();
  if (name === "explore") loadIndex();  // the dial, the band strip and the band chips need it
  // The new view slides in from the side its tab is on; the tab bar's pill slides to it
  $("app").dataset.dir = prev && VIEWS.indexOf(name) < VIEWS.indexOf(prev) ? "back" : "fwd";
  $("tabbar").style.setProperty("--i", VIEWS.indexOf(name));
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll("#tabbar [data-tab]").forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // The radio bar shows on every view but Radio, which has the full readout
  $("radiobar").hidden = name === "radio";
  document.body.classList.toggle("with-radiobar", name !== "radio");
  document.body.classList.toggle("on-radio", name === "radio");  // the controls' dock shows only here
  store.set("rf919.view", name);
  setHash(name === "explore" && view.exploreK != null ? view.exploreK : name);
  if (changed) {
    window.scrollTo(0, scrollMem[name] || 0);
    if (focus) { if (name === "explore" && inDetail()) focusDetail(); else $(`t-${name}`).focus({preventScroll: true}); }
  }
  barState();
}
// The top bar turns to glass once the page scrolls under it; a large title hands over to the bar's small one
export function barState() {
  const v = current && $(`view-${current}`);
  if (!v) return;
  v.classList.toggle("scrolled", window.scrollY > 2);
  // Explore's detail has no large title: its dial hands over to the bar's title instead
  const title = v === $("view-explore") && inDetail() ? v.querySelector(".d-dial, .d-freq") : v.querySelector(".large-title");
  const bar = v.querySelector(".appbar");
  v.classList.toggle("collapsed", !!title && !!bar && title.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
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
  exploreScreen(k !== null);
  if (k !== null && k !== view.k) show(k);
  else if (k === null) { Object.assign(view, {k: null, data: null, err: null, near: []}); renderView(); }
  else renderView();
}
// ---- Explore's two screens: home (search, bands, Discover) and detail (one frequency) ----
// Opening a frequency from home adds a history entry, so Back (the system's or the bar's ←) returns home; moving
// along the dial inside detail replaces it
let homeScroll = 0, openerK = null, toSearch = false;
export const inDetail = () => $("view-explore").dataset.mode === "detail";
// Switches the screen; on Explore itself it also slides it in (the tabs' animation). false: it was already there
function exploreScreen(detail) {
  const v = $("view-explore"), mode = detail ? "detail" : "home";
  if (v.dataset.mode === mode) return false;
  if (current === "explore") {
    if (detail) homeScroll = window.scrollY;
    $("app").dataset.dir = detail ? "fwd" : "back";
    v.style.animation = "none"; void v.offsetWidth; v.style.animation = "";
  }
  v.dataset.mode = mode;
  return true;
}
const focusDetail = () => { const f = document.querySelector("#dossier .d-freq"); if (f) f.focus({preventScroll: true}); };
// A search, a shared link, a band, a Discover or Nearby row, the dial. Stepping along the dial doesn't fill Recent.
// push: a history entry (default: when coming from home or another tab)
export function lookUp(k, {recent = true, push} = {}) {
  if (recent) addRecent(k);
  const fromHome = !(current === "explore" && inDetail());
  if (fromHome) openerK = k;
  view.follow = false;
  view.exploreK = k;
  if (current !== "explore") go("explore", {focus: false});
  const entering = exploreScreen(true);
  if (push ?? fromHome) { try { history.pushState({detail: true}, "", `#f=${k}`); } catch { /* sandboxed */ } }
  else setHash(k);
  if (k !== view.k) show(k);
  else renderView();
  if (entering) { window.scrollTo(0, 0); focusDetail(); barState(); }
}
// Back to Explore's home: the detail's entry if this page added it, else in place (a shared link opened straight in)
// search: land in the search field (the bar's search button)
export function exploreBack({search = false} = {}) {
  toSearch = search;
  if (history.state && history.state.detail) history.back();
  else exploreHome();
}
export function exploreHome() {
  view.exploreK = null;
  if (!view.follow) Object.assign(view, {k: null, data: null, err: null, near: []});
  const changed = exploreScreen(false);
  renderView();
  if (current !== "explore") return;
  setHash("explore");
  if (changed) {
    window.scrollTo(0, homeScroll);
    // The focus goes back to what opened the frequency (a chip, a row), else to the title
    const from = openerK != null && document.querySelector(`#x-home :is([data-look="${openerK}"], [data-to="${openerK}"], [data-go="${openerK}"])`);
    (toSearch ? $("q") : from || $("t-explore")).focus({preventScroll: true});
  }
  toSearch = false;
  barState();
}
export function route() {
  const k = fromHash(), h = location.hash.slice(1);
  if (k) lookUp(k, {push: false});
  else if (h === "explore" && current === "explore" && inDetail()) exploreHome();
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
  try { history.replaceState(history.state, "", h || location.pathname + location.search); } catch { /* sandboxed */ }
}
export function fromHash() {
  const m = location.hash.match(/^#f=(\d{1,7})$/);
  return m && +m[1] > 0 ? +m[1] : null;
}

// ---- the Remote: a native <dialog> (focus trap, Esc, backdrop and focus return come with it) ----
// Sheets open at a detent; the page behind steps back (CSS, bottom sheets only)
export function openSheet(d, detent = "medium") {
  if (d.open) return;
  d.dataset.detent = detent;
  document.body.style.setProperty("--sy", `${window.scrollY}px`);
  document.body.classList.add("sheet-open");
  d.showModal();
}
// The Remote opens at the medium height on its keys, full height on the keypad or direct tune
export function openRemote() { openSheet($("remote"), $("remote-seg").querySelector("input:checked").value === "keys" ? "medium" : "large"); }
export function closeRemote() { if ($("remote").open) $("remote").close(); }
// The tools of Memories and More, and Explore's full schedule: one sheet, a pane each, titled by the row that
// opened it (or by title)
export function openTool(id, title = null) {
  const pane = $(id), row = document.querySelector(`[data-tool="${id}"]`);
  if (!pane) return;
  $("tools-title").textContent = title ?? (row ? row.textContent.trim() : "");
  for (const p of $("tools").querySelectorAll(".tool")) p.hidden = p !== pane;
  $("tools").querySelector(".sheet-body").scrollTop = 0;
  openSheet($("tools"), "large");
}
// The Remote's panes (Keys, Keypad, Tune); the keypad and direct tune need the sheet's full height
export function remotePane(name) {
  for (const p of $("remote").querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== name;
  const input = $("remote-seg").querySelector(`input[value="${name}"]`);
  if (input) input.checked = true;
  if (name !== "keys" && !matchMedia(SIDE_SHEETS).matches) $("remote").dataset.detent = "large";
}

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
  // Under the digits: the channel, and what's on the air there (else the unit)
  const sub = [$("preset").textContent, view.radioName || (d && !d.alert && d.unit)].filter(Boolean).join(" · ");
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
  $("ask-ok").className = danger ? "danger filled" : "filled";
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
  let barFrame = 0;
  window.addEventListener("scroll", () => { cancelAnimationFrame(barFrame); barFrame = requestAnimationFrame(barState); }, {passive: true});
  $("remote").addEventListener("click", (e) => { if (e.target === $("remote") || e.target.closest("[data-close]")) closeRemote(); });
  for (const d of [$("remote"), $("tools")]) d.addEventListener("close", () => document.body.classList.remove("sheet-open"));
  $("tools").addEventListener("click", (e) => { if (e.target === $("tools") || e.target.closest("[data-close]")) $("tools").close(); });
  document.addEventListener("click", (e) => { const t = e.target.closest("[data-tool]"); if (t) openTool(t.dataset.tool); });
  $("remote-seg").addEventListener("change", (e) => remotePane(e.target.value));
  $("open-remote").addEventListener("click", openRemote);
  $("rb-open").addEventListener("click", openRemote);
  $("x-back").addEventListener("click", () => exploreBack());
  $("x-search").addEventListener("click", () => exploreBack({search: true}));

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
  sheetDrag($("remote"), [$("remote-grab"), $("remote").querySelector(".sheet-head"), $("remote").querySelector(".sheet-tabs")], {onClose: closeRemote});
  sheetDrag($("tools"), [$("tools-grab"), $("tools").querySelector(".sheet-head")], {onClose: () => $("tools").close()});
  swipeAway($("toast"), () => { $("toast").hidden = true; });
  document.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-band-select]");
    if (!sel || !sel.value) return;
    if (navigator.vibrate) navigator.vibrate(15);
    send(() => link ? link.tune(sel.value, 0) : Promise.reject(new Error("not connected")));
  });
  fillBandSelects();
}
