import {Logbook, Signal, toAdif, toCsv} from "../logbook.js";
import {flagHtml, fmtKHz, ituFlag} from "../radiomap.js";
import {waiters} from "../state.js";
import {ReplayLink, VirtualLink, errText} from "../link.js";
import {$, bandIco, current, esc, go, lookUp, state, tabDir, toast, vt} from "./shell.js";
import {bandFor} from "../memories.js";
import {mem, nameOf, rm, store, swPick, view} from "./radio.js";
import {link} from "./more.js";
import {swipeRows} from "./gestures.js";

// ---- The Log tab: what the radio stayed on (logbook.js), named from radiomap.cl, with its best signal ----
// The test replay's entries (?demo) live only while it runs: never saved, gone when it stops. No radio's are kept
let saveTimer = 0, renderFrame = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set("rf919.log", logbook.entries.filter((e) => !e.demo)), 1500); };
const renderSoon = () => { cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(() => { if (current === "log") renderLog(); }); };
// An entry growing (every few seconds) is saved but doesn't redraw the list: that would cut a swipe short
export const logbook = new Logbook([], {onChange(type, e) {
  if (type === "open") { nameEntry(e); renderSoon(); }
  saveSoon();
}});
export const signal = new Signal();
// filter: "all" | "star" | a band; k: one frequency (from "Logged 3×" on its card)
const lf = {filter: "all", k: null};

// Who was on air on e.k when the entry opened
function nameEntry(e) {
  rm.lookup(e.k).then((d) => {
    if (d.shortwave.length) {
      const s = swPick(d.shortwave, e.start).head.e;
      Object.assign(e, {station: s.station || "", flag: ituFlag(s.itu) || "", country: s.country || ""});
    } else if (d.stations.length) {
      const s = d.stations[0];
      Object.assign(e, {station: nameOf(d), flag: s.category === "global" ? "" : "cl", country: s.category === "global" ? "Worldwide" : "Chile"});
    }
    saveSoon();
    renderSoon();
    if (view.k === e.k) renderHeard();
  }, () => {});
}

// ---- what the page feeds it ----
// The radio's settled frequency (radio.js radioFreq); nothing counts while it's busy with memories
export function logFreq(k) {
  const f = waiters.freq, busy = mem.run || (mem.test && mem.test.busy);
  logbook.feed(state.ok && !busy && f ? k : null, f && f.band, Date.now(), {mode: state.fields.demod || "", demo: link instanceof ReplayLink, virtual: link instanceof VirtualLink});
  signal.reset();
  renderSignal();
  renderSoon();  // the row that was "now" gets its length
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// An RSSI or SNR reading (shell.js handlers.field)
export function logSignal() {
  const rssi = num(state.fields.rssi), snr = num(state.fields.snr), t = Date.now();
  if (rssi == null && snr == null) return;
  signal.add(rssi, snr, t);
  logbook.signal({rssi, snr}, t);
  cancelAnimationFrame(sigFrame); sigFrame = requestAnimationFrame(renderSignal);
}
// The link dropped or the replay stopped
export function logOff() {
  logbook.feed(null, null, Date.now());
  if (logbook.dropDemo()) renderSoon();
  signal.reset();
  renderSignal();
}

// ---- the signal meter, top right of the Radio card: a line each for RSSI and SNR, its value and the last 60 s ----
// Two measures on their own scales, so two small charts rather than one with two axes; the line in the muted ink,
// the latest reading in the accent, a dashed line at the best. Hover or drag: the reading at that moment
let sigFrame = 0, hoverT = null;
const W = 120, H = 28;
function spark(key) {
  const pts = signal.pts.filter((p) => p[key] != null);
  if (!pts.length) return null;
  const t1 = pts[pts.length - 1].t, t0 = t1 - signal.span, vals = pts.map((p) => p[key]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
  const x = (t) => ((t - t0) / signal.span * W).toFixed(1), y = (v) => (H - 2 - (v - lo) / (hi - lo) * (H - 4)).toFixed(1);
  const best = signal.best(key), cur = pts[pts.length - 1];
  const hov = hoverT != null ? pts.reduce((b, p) => Math.abs(p.t - hoverT) < Math.abs(b.t - hoverT) ? p : b) : null;
  return {pts, cur, best, hov, svg: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="sig-best" x1="0" x2="${W}" y1="${y(best)}" y2="${y(best)}"/>` +
    `<polyline class="sig-line" points="${pts.map((p) => `${x(p.t)},${y(p[key])}`).join(" ")}"/>` +
    (hov ? `<line class="sig-hair" x1="${x(hov.t)}" x2="${x(hov.t)}" y1="0" y2="${H}"/>` : "") +
    // the latest reading (or the one hovered): a dot that stays round however the chart stretches
    `<line class="sig-now" x1="${x((hov || cur).t)}" x2="${x((hov || cur).t)}" y1="${y((hov || cur)[key])}" y2="${y((hov || cur)[key])}"/></svg>`};
}
function tileHtml(key, label) {
  const s = spark(key);
  // No reading yet (a frequency change resets the meter): the tile keeps its place and size, so the page doesn't jump
  if (!s) return `<div class="sig-tile empty" role="img" aria-label="${label}: no reading yet"><span class="sig-l">${label}</span>` +
    `<span class="sig-v"><b>–</b></span><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg></div>`;
  const shown = s.hov || s.cur;
  const trend = s.pts.length > 1 ? Math.sign(s.cur[key] - s.pts[0][key]) : 0;
  const aria = `${label} ${s.cur[key]}, best ${s.best} in the last minute${trend > 0 ? ", rising" : trend < 0 ? ", falling" : ""}`;
  return `<div class="sig-tile" role="img" aria-label="${aria}"><span class="sig-l">${label}</span>` +
    `<span class="sig-v"><b>${shown[key]}</b></span>${s.svg}</div>`;
}
export function renderSignal() {
  const box = $("sig");
  if (!box) return;
  // Both tiles always: the readout (and the meter in it) shows only while a radio is on
  const html = tileHtml("rssi", "RSSI") + tileHtml("snr", "SNR");
  box.hidden = false;
  if (box.dataset.html !== html) box.innerHTML = box.dataset.html = html;
}

// ---- the list ----
const DAY = 86400000;
const dayOf = (t) => Math.floor(t / DAY) * DAY;
const hhmmUTC = (t) => new Date(t).toISOString().slice(11, 16);
const mins = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`; };
export function agoText(t, now = Date.now()) {
  const d = Math.floor((dayOf(now) - dayOf(t)) / DAY);
  if (d <= 0) { const m = Math.round((now - t) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : `${Math.round(m / 60)} h ago`; }
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const dayLabel = (t, now = Date.now()) => {
  const d = Math.floor((dayOf(now) - dayOf(t)) / DAY), date = new Date(t).toLocaleDateString(undefined, {day: "numeric", month: "short", timeZone: "UTC"});
  return d === 0 ? `Today · ${date}` : d === 1 ? `Yesterday · ${date}` : new Date(t).toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "short", timeZone: "UTC"});
};
const shownEntries = () => logbook.entries.filter((e) => (lf.k == null || e.k === lf.k) &&
  (lf.filter === "all" || (lf.filter === "star" ? e.star : e.band === lf.filter)));

function rowHtml(e) {
  const name = e.station || fmtKHz(e.k), live = logbook.here && logbook.here.entry === e;
  const sub = [fmtKHz(e.k), e.mode, e.rssi != null && `RSSI ${e.rssi}`, e.snr != null && `SNR ${e.snr}`, e.demo && "Replay", e.virtual && "No radio"].filter(Boolean).join(" · ");
  return `<li class="mem-row log-row${live ? " live" : ""}" data-id="${esc(e.id)}"><div class="mr-fg">` +
    `<span class="log-time"><b>${hhmmUTC(e.start)}</b><small>${live ? "now" : mins(e.end - e.start)}</small></span>` +
    `<a class="mr-main log-open" href="#f=${e.k}" data-log-open="${e.k}" aria-label="${esc(name)}, ${fmtKHz(e.k)}, ${hhmmUTC(e.start)} UTC: listen again">` +
    `<b>${flagHtml(e.flag, e.country || "")}${esc(name)}</b><small>${bandIco(e.band || bandFor(e.k))}${esc(sub)}</small></a>` +
    `<button class="icon log-star" type="button" data-log="star" data-id="${esc(e.id)}" aria-pressed="${!!e.star}" aria-label="Star ${esc(name)}">` +
    `<svg class="ico" aria-hidden="true"><use href="#i-pin"/></svg></button>` +
    `<button class="mr-del" type="button" data-log="del" data-id="${esc(e.id)}" aria-label="Delete ${esc(name)} at ${hhmmUTC(e.start)}">✕</button></div>` +
    `<button class="mr-act" type="button" data-log="del" data-id="${esc(e.id)}" tabindex="-1" aria-hidden="true">Delete</button></li>`;
}

export function renderLog() {
  const now = Date.now(), all = logbook.entries, today = all.filter((e) => dayOf(e.start) === dayOf(now)).length;
  $("log-total").textContent = all.length ? `Today · ${today} · UTC` : "";
  // Filters: All, Starred, then the bands in the log; a frequency picked from its card shows as a chip to clear
  const bands = [...new Set(all.map((e) => e.band).filter(Boolean))];
  if (!["all", "star", ...bands].includes(lf.filter)) lf.filter = "all";
  const chip = (v, label) => `<label><input type="radio" name="logf" value="${v}"${lf.filter === v ? " checked" : ""}><span>${label}</span></label>`;
  $("log-filter").innerHTML = `<legend>Show</legend>` + chip("all", "All") + chip("star", "Starred") + bands.map((b) => chip(b, `${bandIco(b)}${b}`)).join("") +
    (lf.k != null ? `<button class="chip" type="button" data-log="unk" aria-label="Show every frequency">${fmtKHz(lf.k)} ✕</button>` : "");
  $("log-filter").hidden = !all.length;
  $("log-menu").hidden = !all.length;
  const list = shownEntries();
  if (!all.length) {
    $("log-list").innerHTML = `<div class="panel empty-row"><b>Nothing logged yet</b><span>Stay on a frequency for 30 seconds and it's ` +
      `logged here, with its station and its best signal.</span>${state.ok ? "" : `<div class="intro-act"><button class="filled" type="button" data-act="connect">Connect radio</button>` +
      `<button type="button" data-act="noradio">No radio</button></div>`}</div>`;
    return;
  }
  if (!list.length) { $("log-list").innerHTML = `<div class="panel empty-row"><b>Nothing here</b><span>No entry matches this filter.</span></div>`; return; }
  // Newest first, one list with a heading per UTC day that stays in view
  const days = new Map();
  for (const e of [...list].reverse()) { const d = dayOf(e.start); if (!days.has(d)) days.set(d, []); days.get(d).push(e); }
  $("log-list").innerHTML = `<div class="panel list-panel log-days">` + [...days].map(([d, es]) => `<section class="log-day" aria-label="${dayLabel(d, now)}">` +
    `<h2 class="h log-day-h"><span>${dayLabel(d, now)}</span><span>${es.length}</span></h2><ul class="list">${es.map(rowHtml).join("")}</ul></section>`).join("") + `</div>`;
}

// "Logged 3× · last yesterday" under a frequency's name (Radio and Explore); a tap opens the Log on it
export function heardHtml(k) {
  const {n, last} = logbook.heard(k);
  if (!n) return "";
  return `<button class="d-heard" type="button" data-act="logk" data-k="${k}">${n === 1 ? "Logged once" : `Logged ${n}×`} · last ${agoText(last)}</button>`;
}
function renderHeard() {
  const el = document.querySelector("#dossier .d-heard");
  if (el && view.k != null) el.outerHTML = heardHtml(view.k) || "";
}
export function showLogFor(k) {
  lf.k = k; lf.filter = "all";
  try { history.pushState(null, "", "#log"); } catch { /* sandboxed */ }
  vt(() => go("log"), {dir: tabDir("log")});
}

async function exportLog(kind) {
  const list = shownEntries(), d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = `rf919-log-${d}.${kind === "adif" ? "adi" : "csv"}`, text = kind === "adif" ? toAdif(list) : toCsv(list);
  const file = new File([text], name, {type: kind === "adif" ? "text/plain" : "text/csv"});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: "RF919 listening log"}); return; }
    catch (e) { if (e.name === "AbortError") return; toast(`Share failed: ${errText(e)}`, 4000, true); }
  }
  const url = URL.createObjectURL(file), a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Saved ${name} · ${list.length} ${list.length === 1 ? "entry" : "entries"}`);
}

export function init() {
  logbook.entries = store.get("rf919.log", []).filter((e) => e && e.k > 0 && e.start > 0 && !e.demo);  // the saved log (radio.js's store is ready now)
  setInterval(() => { if (state.ok) logbook.tick(Date.now()); }, 2000);
  $("log-filter").addEventListener("change", (e) => { if (e.target.name === "logf") { lf.filter = e.target.value; renderLog(); } });
  $("view-log").addEventListener("click", (e) => {
    const open = e.target.closest("[data-log-open]");
    if (open) { e.preventDefault(); lookUp(+open.dataset.logOpen); return; }  // with Tune as you explore on, it tunes again
    const b = e.target.closest("[data-log]");
    if (!b) return;
    const act = b.dataset.log;
    if (act === "unk") { lf.k = null; renderLog(); return; }
    const entry = logbook.entries.find((x) => x.id === b.dataset.id);
    if (!entry) return;
    if (act === "star") { entry.star = !entry.star; saveSoon(); renderLog(); }
    else if (act === "del") {
      const r = logbook.remove(entry.id);
      saveSoon(); renderLog();
      toast(`Deleted ${entry.station || fmtKHz(entry.k)}`, 5000, false, {label: "Undo", run: () => { logbook.restore(r); saveSoon(); renderLog(); }});
    }
  });
  // Export lives in the ⋯ sheet, outside the view
  $("log-export").addEventListener("click", (e) => { const b = e.target.closest("[data-log]"); if (b) exportLog(b.dataset.log); });
  swipeRows($("log-list"));
  // The meter: the reading under the finger or the pointer
  const sig = $("sig");
  const at = (e) => {
    const svg = e.target.closest(".sig-tile") && e.target.closest(".sig-tile").querySelector("svg");
    if (!svg || !signal.pts.length) return;
    const r = svg.getBoundingClientRect(), t1 = signal.pts[signal.pts.length - 1].t;
    hoverT = t1 - signal.span + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * signal.span;
    renderSignal();
  };
  sig.addEventListener("pointermove", at);
  sig.addEventListener("pointerdown", at);
  sig.addEventListener("pointerleave", () => { hoverT = null; renderSignal(); });
  renderLog();
  Object.assign(window, {logbook, signal});  // for the browser checks (dwellMs) and the console
}
