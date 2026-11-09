import {KEYS, pad2} from "../protocol.js";
import {EMPTY_FREQ, FLAG_CDN, RADIOMAP_SITE, RadioMap, aimedAt, daysText, dur, flagHtml, fmtKHz, fmtShift, globeSvg, haversineKm, hhmmMin, ituFlag, kmBearing, minHHMM, nearby, parseFreqInput, radiomapUrl, span, stationFlag, stepKnown, stripTicks, swAir, swOnAir, targetsAt, targetsName, todayWindows, utcDay} from "../radiomap.js";
import {SW_METERS, addToList, bandChips, bandFor, bandRange, memKey, nearestStations, stripRange} from "../memories.js";
import {errText} from "../link.js";
import {$, bandIco, current, esc, exploreBack, go, goTo, inDetail, log, lookUp, openFrom, openTool, renderMini, route, setBarsMin, state, tabDir, toast, tuneHere, tuneKHz, vt} from "./shell.js";
import {addMem, canStoreHere, fetchAll, jobs, radiomapIndex, renderStoreHere, renderSwChips, storeHere} from "./memories.js";
import {swipeTune} from "./gestures.js";
import {heardHtml, logFreq, showLogFor} from "./log.js";
import {firstHit, indexVersion, renderPicks, renderResults} from "./find.js";
import {startBle, startNoRadio} from "./more.js";
import {TIER_KEY, airEstimate, askPosition, canEstimate, openProp, propBadge, renderConditions, rowBars, rowSay, stationEstimate, tintedWindows, windowsSay} from "./reception.js";

// ---- What's on a frequency (radiomap.cl) ----
// Per-viewer conveniences only; the page works the same when storage is unavailable
export const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
export const rm = new RadioMap();
// Memories: the list to store, this app's record of what it stored per band:channel, and the running job
export const mem = {list: addToList([], store.get("rf919.memlist", []).filter((e) => e && e.band && e.kHz > 0)).list,
  recordKey: "rf919.memories", record: store.get("rf919.memories", {}), run: null, pos: -1, step: "", t0: 0, from: 0, fail: null, check: null,
  job: null, picks: {sw: null, near: null}, test: null};
// radioK: where the radio is; k: what the page shows; follow: k tracks the radio (a search pins k instead).
// near: nearby frequencies with their lookups
// flag: the flag-icons key of the station the card headlines (its background), "" for none
// tuning: the page's last tune of the radio, {k, state} (see Tuner)
// sweeping: the radio's frequency keeps moving (a seek, a fast scan) faster than it settles; moves counts the unsettled
// changes. scanning: the radio is in SCAN (its key, or its "SCAN" message) until another key or "SCAN STOP".
// key: the last key this page sent, {code, at} (a sweep right after a key other than SCAN is a seek)
export const view = {radioK: null, pendingK: undefined, k: null, follow: true, data: null, err: null, near: [], idx: null,
  all: false, showAll: false, timer: 0, unit: "MHz", flag: "", radioName: "", tuning: null, sweeping: false, moves: 0, scanning: false, scanT: 0, key: null};
export let nearMe = store.get("rf919.nearme", false), myPos = store.get("rf919.pos", null);
export const following = () => view.follow && state.ok;
// Near me filters as well as sorts: stations beyond the radius, and shortwave not aimed at the listener's region.
// Show all (per frequency) lifts it in the frequency panels; Nearby keeps filtering
export const RADII = [25, 50, 100, 250, 500, 0];
  // km; 0 = any distance
export let radius = store.get("rf919.radius", 100), myTargets = targetsAt(myPos);
export const located = () => !!(nearMe && myPos);
export const filtering = () => located() && !view.showAll;
export const myRegion = () => targetsName(myTargets);
// {shown, hidden}: stations within the radius (and those with no position, such as the worldwide channels)
export function stationView(list = view.data.stations, on = filtering()) {
  const rows = stationRows(list);
  if (!on || !radius) return {shown: rows, hidden: 0};
  const shown = rows.filter((r) => r.km == null || r.km <= radius);
  return {shown, hidden: rows.length - shown.length};
}
// {shown, hidden}: the shortwave entries aimed at the listener's region
export function swView(list, on = filtering()) {
  if (!on) return {shown: list, hidden: 0};
  const shown = list.filter((e) => aimedAt(e, myTargets));
  return {shown, hidden: list.length - shown.length};
}
export const showAllBtn = (label = "Show all") => `<button class="small" type="button" data-act="showall">${label}</button>`;

// Debounced, so a SCAN or seek sweep only looks up the frequency it settles on. Until then the card's station is stale
// (paintSweep); a second change before the last one settled is a sweep
export function radioFreq(k) {
  if (k === view.pendingK) return;
  view.pendingK = k;
  clearTimeout(view.timer);
  if (k !== null && ++view.moves >= 2) view.sweeping = true;
  if (view.scanning) setScanning(true);  // a scan that stopped by itself (no change for a while) ends on its own
  paintSweep();
  view.timer = setTimeout(() => {
    view.moves = 0;
    view.sweeping = false;
    view.radioK = k;
    logFreq(k);
    nameRadio(k);
    if (view.follow && k !== null && k !== view.k) show(k);
    else renderView();
  }, 500);
}

// What's on the air where the radio is, for the mini player (the lookup is cached, so the dossier shares it)
function nameRadio(k) {
  view.radioName = "";
  renderMini();
  if (k === null) return;
  rm.lookup(k).then((d) => { if (view.radioK === k) { view.radioName = nameOf(d); renderMini(); } }, () => {});
}

// Radio: a station change redraws the card and the lists under it from empty (Also on and Nearby go, the card turns
// to a skeleton) before they fill again. The page got shorter than the screen for a moment, which scrolled it to the
// top and jolted the bars; the info keeps its height until Nearby has its rows (or 2.5 s at most)
let holdT = 0;
function holdHeight() {
  const info = $("info");
  clearTimeout(holdT);
  if (!following()) { info.style.minHeight = ""; return; }
  info.style.minHeight = `${Math.max(info.offsetHeight, parseFloat(info.style.minHeight) || 0)}px`;
  holdT = setTimeout(releaseHeight, 2500);
}
function releaseHeight() { clearTimeout(holdT); $("info").style.minHeight = ""; }

export async function show(k) {
  holdHeight();
  Object.assign(view, {k, data: null, err: null, near: [], all: false, showAll: false});
  renderView();
  try {
    const data = await rm.lookup(k);
    if (view.k !== k) return;
    view.data = data;
    log({kind: "radiomap", text: `radiomap ${fmtKHz(k)}: ${data.stations.length} stations, ${data.shortwave.length} shortwave`});
  } catch (e) {
    if (view.k !== k) return;
    view.err = e;
    log({kind: "radiomap", text: `radiomap ${fmtKHz(k)}: ${errText(e)}`});
  }
  renderView();
  loadNearby(k);
}

// ---- No radio: what the virtual radio (virtual.js) hears, from radiomap.cl ----
// airSeek: the next frequency with data in the band (wrapping); null until the index is in
export function airSeek(band, k, dir) {
  const r = bandRange(band);
  if (!view.idx) { loadIndex(); return null; }
  const fs = r ? view.idx.freqs.filter((f) => f >= r[1] && f <= r[2]) : [];
  if (!fs.length) return null;
  return stepKnown(fs, k, dir) ?? (dir > 0 ? fs[0] : fs.at(-1));
}
// airSignal: 0..1. Nothing known there: noise. Shortwave: strong while a broadcast is on air, faint between them.
// Anything else known: steady, a little different per frequency. Lookups are fetched once and kept (heard)
const heard = new Map();
let known = null, knownOf = null;
export function airSignal(k) {
  if (!view.idx) { loadIndex(); return .04; }
  if (knownOf !== view.idx) { known = new Set(view.idx.freqs); knownOf = view.idx; }
  if (!known.has(k)) return .04;
  if (!heard.has(k)) {
    if (heard.size >= 300) heard.delete(heard.keys().next().value);
    heard.set(k, null);
    rm.lookup(k).then((d) => heard.set(k, d), () => heard.delete(k));
  }
  const d = heard.get(k);
  if (d && d.shortwave && d.shortwave.length) return swOnAir([[k, d]]).length ? .85 : .12;
  return .55 + (k % 7) / 20;
}

// The list of kHz with data, for the dial, the band strip, the band chips and Discover (Nearby loads it too)
export function loadIndex() {
  if (view.idx) return;
  rm.index().then((idx) => {
    const had = view.idx;
    view.idx = idx;
    indexVersion(idx.version);
    if (!had && !view.follow) renderView();
    renderBands();
    renderDiscover();
  }, () => { /* the page works without it */ });
}

export async function loadNearby(k) {
  try {
    const idx = await rm.index();
    if (view.k !== k) return;
    const had = view.idx;
    view.idx = idx;
    if (!had && !view.follow) renderDossier();
    // Filtering by location hides some neighbours, so look at more of them
    const near = view.near = nearby(idx.freqs, k, located() ? 14 : 6).map((f) => ({k: f, data: null}));
    renderNearby();
    releaseHeight();  // the lists have their rows (loading ones hold their height too)
    await Promise.all(near.map(async (n) => {
      try { n.data = await rm.lookup(n.k); } catch { n.data = EMPTY_FREQ; }
      if (view.near === near) renderNearby();
    }));
  } catch { releaseHeight(); /* nearby is optional */ }
}

// ---- rendering ----
export function renderView() {
  renderStoreHere();
  const ok = state.ok, here = following();
  // The readout and the controls travel with the info panels but show only on Radio (Explore doesn't follow the dial)
  $("readout").hidden = !here;
  $("radio-controls").hidden = !here;
  $("connect-card").hidden = ok;
  $("radiobar").classList.toggle("off", !ok);
  if (!ok && $("remote").open) $("remote").close();
  renderDossier();
  renderStations();
  renderNearby();
  // Where the data comes from: in About, and under the full schedule
  const src = $("info-src");
  src.hidden = false;
  src.innerHTML = dataLine();
  // The swipe, told once, the first time there's a frequency to swipe
  if (here && current === "radio" && !store.get("rf919.swiped", false)) {
    store.set("rf919.swiped", true);
    toast("Swipe the frequency to step · flick to seek", 5000);
  }
}
const dataLine = () => `Data: <a href="${RADIOMAP_SITE}" target="_blank" rel="noopener">radiomap.cl</a>` +
  `${view.idx ? ` v${esc(view.idx.version)} · EiBi ${esc(view.idx.shortwaveSeason)}` : ""} · times in UTC`;

// ---- the info under the card: Schedule, Stations or Nearby, one at a time. A tab only for what has something to show;
// the choice is remembered, and gives way when that one is empty ----
const PANES = [["sched-box", "Schedule"], ["stations", "Stations"], ["nearby", "Nearby"]];
let infoPane = store.get("rf919.infopane", null);
export function syncPanes() {
  const have = PANES.filter(([id]) => $(id).innerHTML), on = (have.find(([id]) => id === infoPane) || have[0] || [])[0];
  const seg = $("info-seg"), had = seg.contains(document.activeElement);
  const label = ([id, name]) => {
    const box = $(id), n = box.dataset.n;
    return `${box.dataset.label || name}${n ? `<small>${n}</small>` : id === "sched-box" ? "<small>UTC</small>" : ""}`;
  };
  const html = have.length > 1 ? `<legend>Show</legend>` + have.map((p) =>
    `<label><input type="radio" name="infopane" value="${p[0]}"${p[0] === on ? " checked" : ""}><span>${label(p)}</span></label>`).join("") : "";
  if (seg.dataset.html !== html) {
    seg.innerHTML = seg.dataset.html = html;
    if (had) { const i = seg.querySelector("input:checked"); if (i) i.focus({preventScroll: true}); }
  }
  seg.hidden = have.length < 2;
  for (const [id] of PANES) $(id).hidden = id !== on;
}

export function renderDossier() {
  const box = $("dossier");
  // The card re-renders as a whole; a control with data-keep gets the focus back (the dial, the strip, Pin…)
  const keep = box.contains(document.activeElement) ? document.activeElement.dataset.keep : null;
  box.innerHTML = dossierHtml();
  box.hidden = !box.innerHTML;
  const sched = $("sched-box");
  if (sched.dataset.html !== view.sched) sched.innerHTML = sched.dataset.html = view.sched;
  syncPanes();
  if (keep) { const el = box.querySelector(`[data-keep="${keep}"]`); if (el && !el.disabled) el.focus({preventScroll: true}); }
  // One card: the radio's readout over what's on its frequency, the station's flag behind both
  const now = $("now");
  now.hidden = box.hidden && $("readout").hidden;
  paintSweep();
  // Explore's detail: the bar's title, shown once the dial scrolls under it
  if (!view.follow) $("x-title").textContent = view.k === null ? "Explore" : [fmtKHz(view.k), nameOf(view.data)].filter(Boolean).join(" · ");
}

export function setScanning(on) {
  clearTimeout(view.scanT);
  view.scanning = on;
  if (on) view.scanT = setTimeout(() => setScanning(false), SCAN_IDLE_MS);
  paintSweep();
}
const SCAN_IDLE_MS = 12000;
// The Radio card while the frequency moves: the needle and "Scanning" (or "Seeking") under the digits. Once the radio
// leaves the card's station, that station is stale until the new one is looked up: dimmed, and its flag gone
function paintSweep() {
  const now = $("now"), box = $("dossier");
  if (!now) return;
  const f = following(), anim = f && (view.sweeping || view.scanning);
  const stale = f && view.pendingK != null && view.pendingK !== view.k, flag = stale ? "" : view.flag;
  if (anim && !now.classList.contains("scanning")) {
    const seek = !view.scanning && view.key && view.key.code !== KEYS.SCAN && Date.now() - view.key.at < 2000;
    now.querySelector(".scan-tag").textContent = seek ? "Seeking" : "Scanning";
  }
  now.classList.toggle("scanning", anim);
  now.classList.toggle("stale", stale);
  if (stale) box.setAttribute("aria-busy", "true"); else box.removeAttribute("aria-busy");
  now.style.setProperty("--flag", flag ? `url("${FLAG_CDN}${flag}.svg")` : "none");
  now.classList.toggle("flagged", !!flag);
}

export function dossierHtml() {
  const k = view.k;
  view.flag = "";
  view.sched = "";
  view.links = "";
  // Radio: waiting for the radio (the connect card covers "not connected"); Explore's home has no card
  if (k === null) return view.follow && state.ok ? `<div class="d-empty"><p class="empty-t">Listening…</p><p class="empty-d">Waiting for the radio's frequency.</p></div>` : "";
  // On Radio the readout above shows the frequency; Explore shows the one looked up in the same big digits, on a dial
  const digits = `<p class="d-freq" tabindex="-1" data-keep="freq">${k >= 30000 ? (k / 1000).toFixed(3) : k}<small>${k >= 30000 ? "MHz" : "kHz"}</small></p>`;
  const freq = following() ? "" : view.follow ? digits : dialHtml(k, digits) + stripHtml(k);
  // The actions come right under the name, within reach, and don't wait for radiomap.cl
  if (view.err) return freq + `<p class="of-msg">radiomap.cl unreachable (${esc(errText(view.err))})</p>` + actionsHtml();
  if (!view.data) return freq + `<div class="skeleton" role="status" aria-label="Looking up ${fmtKHz(k)}"><i></i><i></i><i></i></div>` + actionsHtml();
  const {stations, shortwave} = view.data;
  let hero, rest = "", remind = "";
  if (shortwave.length) ({hero, rest, sched: view.sched, remind} = swHtml(shortwave));
  else if (stations.length) {
    const {shown, hidden} = stationView();
    if (shown.length) ({hero, rest} = stationHero(shown[0]));
    else hero = `<div class="d-empty"><p class="empty-t">Nothing near</p><p class="empty-d">No station on ${fmtKHz(k)} within ${radius} km; ` +
      `${hidden} farther away.</p><div class="intro-act">${showAllBtn(`Show ${hidden === 1 ? "it" : `all ${hidden}`}`)}</div></div>`;
  } else hero = `<div class="d-empty"><p class="empty-t">Nothing known</p><p class="empty-d">radiomap.cl has no station on ${fmtKHz(k)}.</p></div>`;
  return freq + hero + heardHtml(k) + actionsHtml(filtersHtml() + view.links, remind) + rest;
}

// ---- the dial: Explore steps through the frequencies radiomap.cl knows, without a radio ----
export const icon = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function dialHtml(k, digits) {
  const f = view.idx && view.idx.freqs;
  if (!f) return digits;
  const step = (dir) => {
    const to = stepKnown(f, k, dir), what = dir < 0 ? "Previous" : "Next";
    return `<button class="icon dial-step" type="button" data-act="dial" data-to="${to ?? ""}" data-keep="dial${dir}"${to == null ? " disabled" : ""} ` +
      `aria-label="${what} frequency with data${to == null ? "" : `: ${fmtKHz(to)}`}">${icon(dir < 0 ? "prev" : "next")}</button>`;
  };
  return `<div class="d-dial">${step(-1)}${digits}${step(1)}</div>`;
}
// The band around k, a tick per kHz with data: where the activity is. Tap or drag to move, arrows to step
function stripHtml(k) {
  const f = view.idx && view.idx.freqs, r = stripRange(k), ticks = f && r ? stripTicks(f, r.lo, r.hi) : [];
  if (!ticks.length) return "";
  const pct = (x) => (Math.max(0, Math.min(1, (x - r.lo) / (r.hi - r.lo))) * 100).toFixed(2);
  const end = (x) => x >= 30000 ? (x / 1000).toFixed(x % 1000 ? 1 : 0) : String(x);
  return `<div class="strip" role="slider" tabindex="0" data-keep="strip" data-lo="${r.lo}" data-hi="${r.hi}" ` +
    `aria-label="${r.label}: ${ticks.length} frequencies with data" aria-valuemin="${r.lo}" aria-valuemax="${r.hi}" aria-valuenow="${k}" ` +
    `aria-valuetext="${fmtKHz(k)}, ${r.label}"><div class="strip-track">${ticks.map((x) => `<i style="left:${pct(x)}%"></i>`).join("")}` +
    `<b class="strip-mark" style="left:${pct(k)}%"></b><span class="strip-tip" hidden></span></div>` +
    `<div class="strip-axis"><span>${end(r.lo)}</span><span>${bandIco(bandFor(k))}${r.label} · ${ticks.length}</span><span>${end(r.hi)}</span></div></div>`;
}
// The known kHz nearest to a point on the strip
function stripAt(strip, x) {
  const t = strip.querySelector(".strip-track").getBoundingClientRect(), lo = +strip.dataset.lo, hi = +strip.dataset.hi;
  const want = lo + Math.max(0, Math.min(1, (x - t.left) / t.width)) * (hi - lo);
  return stripTicks(view.idx.freqs, lo, hi).reduce((b, k) => Math.abs(k - want) < Math.abs(b - want) ? k : b);
}
function stripPreview(strip, k) {
  const lo = +strip.dataset.lo, hi = +strip.dataset.hi, f = (k - lo) / (hi - lo), tip = strip.querySelector(".strip-tip");
  strip.querySelector(".strip-mark").style.left = `${f * 100}%`;
  tip.textContent = fmtKHz(k); tip.hidden = false;
  // Over the mark, but never past the strip's ends (it used to hang off the screen at the band's edges)
  const w = tip.offsetWidth / 2, W = strip.querySelector(".strip-track").clientWidth;
  tip.style.left = `${Math.max(w, Math.min(W - w, f * W))}px`;
}
function wireStrip(box) {
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    const strip = e.target.closest(".strip");
    if (!strip || e.button > 0 || !view.idx) return;
    drag = {id: e.pointerId, k: stripAt(strip, e.clientX)};
    strip.setPointerCapture(e.pointerId);
    stripPreview(strip, drag.k);
  });
  box.addEventListener("pointermove", (e) => {
    const strip = e.target.closest(".strip");
    if (!drag || e.pointerId !== drag.id || !strip) return;
    const k = stripAt(strip, e.clientX);
    if (k !== drag.k) { drag.k = k; stripPreview(strip, k); if (navigator.vibrate) navigator.vibrate(5); }
  });
  box.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = drag.k;
    drag = null;
    if (k !== view.k) lookUp(k); else renderDossier();
  });
  box.addEventListener("pointercancel", () => { if (drag) { drag = null; renderDossier(); } });
  box.addEventListener("keydown", (e) => {
    const strip = e.target.closest(".strip");
    if (!strip || !view.idx || view.k === null) return;
    const f = view.idx.freqs, ticks = stripTicks(f, +strip.dataset.lo, +strip.dataset.hi);
    const to = {ArrowRight: stepKnown(f, view.k, 1), ArrowUp: stepKnown(f, view.k, 1), ArrowLeft: stepKnown(f, view.k, -1),
      ArrowDown: stepKnown(f, view.k, -1), PageUp: stepKnown(f, view.k, 1, 10), PageDown: stepKnown(f, view.k, -1, 10),
      Home: ticks[0], End: ticks[ticks.length - 1]}[e.key];
    if (to === undefined) return;
    e.preventDefault();
    if (to != null && to !== view.k) lookUp(to);
  });
}

// Pins: chips under Explore's search, ahead of the suggestions (find.js renderPicks)
const PIN_MAX = 12;
export const pinned = () => store.get("rf919.pinned", []).filter((k) => k > 0);
export function togglePin(k) {
  const pins = pinned(), on = pins.includes(k);
  if (!on && pins.length >= PIN_MAX) { toast(`${PIN_MAX} pins at most: unpin one first`, 3500, true); return; }
  store.set("rf919.pinned", on ? pins.filter((p) => p !== k) : [k, ...pins]);
  toast(on ? `Unpinned ${fmtKHz(k)}` : `Pinned ${fmtKHz(k)}`, 2000);
  renderPicks();
  renderDossier();
}
// Redraws a box of chips only when it changed, and gives the focus back to the same frequency (the pins' lamps and the
// suggestions redraw as lookups come in, often right after Back has put the focus on one of them)
export function keepFocus(box, html) {
  if (box.dataset.html === html) return;
  const k = box.contains(document.activeElement) ? document.activeElement.dataset.look : null;
  box.innerHTML = box.dataset.html = html;
  const el = k && box.querySelector(`[data-look="${k}"]`);
  if (el) el.focus({preventScroll: true});
}
// The system's share sheet with a link to the lookup (#f=9580); else the link goes to the clipboard
export async function shareFreq(k = view.k) {
  const url = `${location.origin}${location.pathname}#f=${k}`, name = dossierName(), title = name ? `${name} · ${fmtKHz(k)}` : fmtKHz(k);
  if (navigator.share) {
    try { await navigator.share({title, text: title, url}); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied", 2500); }
  catch { toast(url, 8000); }
}

// Explore's home: a shelf of bands, each opening its first frequency on the dial (examples until the index is in)
export function renderBands() {
  const chips = view.idx ? bandChips(view.idx.freqs) : [];
  const examples = [[9580, "9580"], [11620, "11620"], [146730, "146.730"], [101300, "101.3"], [118100, "118.1"]];
  $("bands").innerHTML = chips.length
    ? chips.map((c) => `<button class="chip" type="button" data-act="dial" data-to="${c.k}" aria-label="${c.label}: ${c.n} frequencies with data">` +
      `${bandIco(bandFor(c.k))}${c.label}<small>${c.n}</small></button>`).join("")
    : examples.map(([k, t]) => `<button class="chip" type="button" data-look="${k}" aria-label="Look up ${fmtKHz(k)}">${t}</button>`).join("");
  renderPicks();
}

// What to do with the frequency, under its name: tune, keep, pin, share, then the filters (one row that scrolls
// rather than wraps)
export function actionsHtml(filters = "", remind = "") {
  const k = view.k;
  const tune = !state.ok || following() ? "" : tuneHtml(k);
  const band = bandFor(k), inList = band && mem.list.find((e) => e.band === band && e.kHz === k);
  // Add means the app's list, Store means the radio: one of the two per context, and a status that says which it reached
  const stored = inList && (mem.record[memKey(band, inList.ch)] || {}).kHz === k;
  const add = !band ? "" : inList ? `<button class="small" type="button" disabled>${stored ? "On radio" : "In list"} · ${band} CH ${inList.ch}</button>`
    : following() ? "" : `<button class="small" type="button" data-act="addmem">+ Add to list</button>`;
  // On Radio: store what the radio is on, on the channel after the last one in use
  const here = following() ? `<button class="small" type="button" id="storehere" data-act="storehere"${canStoreHere() ? "" : " disabled"} ` +
    `title="Saves what the radio is tuned to on the channel after the last one in use">Store on radio</button>` : "";
  const pin = pinned().includes(k);
  const keep = `<button class="small icon" type="button" data-act="pin" data-keep="pin" aria-pressed="${pin}" aria-label="${pin ? "Unpin" : "Pin"} ${fmtKHz(k)}" ` +
    `title="${pin ? "Unpin" : "Pin it under Explore's search"}">${icon("pin")}</button>` +
    `<button class="small icon" type="button" data-act="share" aria-label="Share ${fmtKHz(k)}" title="Share a link to this lookup">${icon("share")}</button>`;
  return `<div class="d-actions" role="group" aria-label="Actions">${tune}${add}${here}${keep}${remind}` +
    `${filters ? `<span class="d-sep" aria-hidden="true"></span>${filters}` : ""}</div>`;
}
// Explore: where the radio is with this frequency. On it; on the way (the tune, then the radio's report of it,
// which settles 500 ms later); else Tune radio (the switch is off, or the tune failed or landed elsewhere)
function tuneHtml(k) {
  const t = view.tuning && view.tuning.k === k ? view.tuning : null;
  const busy = t && (t.state === "pending" || t.state === "tuning" || (t.state === "done" && view.pendingK === k && view.radioK !== k));
  if (k === view.radioK && !busy) return `<span class="small tune-state on">${icon("check")}On the radio</span>`;
  if (busy) return `<span class="small tune-state"><i class="tune-spin" aria-hidden="true"></i>Tuning…</span>`;
  return `<button class="small filled" type="button" data-act="tunehere" aria-label="Tune the radio to ${fmtKHz(k)}">Tune radio</button>`;
}
// Filters for what the card and the lists show: by distance and by where shortwave is aimed
function filtersHtml() {
  const d = view.data;
  if (!d || !(d.stations.length || d.shortwave.length)) return "";
  const near = `<button class="small toggle" type="button" data-act="nearme" aria-pressed="${nearMe}">Near me</button>`;
  const radSel = located() && d.stations.length
    ? `<select class="radius" data-act="radius" aria-label="Distance">` +
      RADII.map((r) => `<option value="${r}"${r === radius ? " selected" : ""}>${r ? `≤ ${r} km` : "any km"}</option>`).join("") + `</select>` : "";
  const refilter = located() && view.showAll ? `<button class="small" type="button" data-act="refilter">Near only</button>` : "";
  return near + radSel + refilter;
}
// A flag-icons key the card can show behind the station ("" for none: the globe, or no country)
const bgFlag = (key) => key && /^[a-z]{2}(-[a-z]{2})?$/.test(key) ? key : "";
// The name to keep with a memory of the frequency on show: who's on air (or next), else the first station
export const dossierName = () => nameOf(view.data);
export function nameOf(d) {
  if (!d) return "";
  if (d.shortwave.length) { const sw = swView(d.shortwave).shown; return swPick(sw.length ? sw : d.shortwave).head.e.station || ""; }
  if (d.stations.length) { const {s} = stationView(d.stations).shown[0] || stationRows(d.stations)[0]; return s.nombre || s.signal || ""; }
  return "";
}

export const hhmm = (s) => `${s.slice(0, 2)}:${s.slice(2)}`;
// The schedule's state now: which entries are on, the next to start, and the one to headline
export function swPick(list, now = Date.now()) {
  const rows = list.map((e) => ({e, air: swAir(e, now), today: todayWindows(e, now)}));
  const on = rows.filter((r) => r.air.on);
  const next = rows.filter((r) => r.air.startsIn != null).sort((a, b) => a.air.startsIn - b.air.startsIn)[0];
  return {rows, on, next, head: on[0] || next || rows[0]};
}

export function swHtml(all) {
  const {shown: list, hidden} = swView(all);
  if (!list.length) {
    return {hero: `<div class="d-empty"><p class="empty-t">Not aimed here</p><p class="empty-d">Nothing on ${fmtKHz(view.k)} is aimed at ` +
      `${esc(myRegion())}; ${hidden} broadcast${hidden === 1 ? "" : "s"} to elsewhere.</p><div class="intro-act">${showAllBtn()}</div></div>`, rest: ""};
  }
  const now = Date.now(), m = (now - utcDay(now)) / 60000;
  const {rows, on, next, head} = swPick(list, now), e = head.e;
  const sub = head.air.on ? `until ${minHHMM(hhmmMin(e.endUTC))} · ${dur(head.air.endsIn)} left${on.length > 1 ? ` · ${on.length - 1} more on air` : ""}`
            : head.air.startsIn != null ? `next at ${hhmm(e.startUTC)} UTC · in ${dur(head.air.startsIn)}`
            : "nothing scheduled in the coming weeks";
  const meta = [e.country, [e.langLabel || e.lang, e.targetLabel || e.target].filter(Boolean).join(" → ")].filter(Boolean).join(" · ");
  view.flag = bgFlag(ituFlag(e.itu));
  const grid = [];
  if (e.site && e.site.name) {
    const siteFlag = e.site.itu && e.site.itu !== e.itu ? flagHtml(ituFlag(e.site.itu), e.site.itu) : "";
    grid.push(`<div><dt>Transmitter</dt><dd>${siteFlag}${esc(e.site.name)}</dd></div>`);
  }
  grid.push(`<div><dt>Days</dt><dd>${esc(daysText(e))}</dd></div>`);
  if (nearMe && myPos && e.site && e.site.lat != null) grid.push(distDd(e.site));
  if (e.lastHeard) grid.push(`<div><dt>Last heard</dt><dd>${esc(e.lastHeard.slice(0, 2))}/20${esc(e.lastHeard.slice(2))}</dd></div>`);
  // Each window tinted by what the estimate says for that hour
  const windows = rows.flatMap((r) => tintedWindows(r, view.k, now)), say = windowsSay(windows), tinted = !!say;
  const wins = windows.map(({s, t, tier}) => `<i class="win${tier ? ` p-${tier}` : ""}" style="left:${s / 14.4}%;width:${(t - s) / 14.4}%"></i>`).join("");
  const est = airEstimate(head, view.k, now), badge = propBadge(est, view.k, head.air.on ? "" : hhmm(e.startUTC));
  // The schedule inline: what's on now and the next few; all of it in a sheet (no scrolling box inside the page)
  const at = Math.max(0, rows.findIndex((r) => r.air.on || r === next));
  const inline = rows.length <= SLOTS_INLINE ? rows : [...rows, ...rows].slice(at, at + SLOTS_INLINE);
  const full = rows.length > inline.length
    ? `<button class="more" type="button" data-act="sched" aria-haspopup="dialog">Full schedule · ${rows.length}</button>` : "";
  return {hero: `<div class="d-head"><span class="pill${head.air.on ? " on" : ""}">${head.air.on ? "On air" : "Off air"}</span><span class="d-sub">${esc(sub)}</span></div>
    <h3 class="d-name">${view.flag ? "" : flagHtml(ituFlag(e.itu), e.country)}${esc(e.station)}</h3>
    <p class="d-meta">${esc(meta)}</p>${badge}`,
  remind: remindHtml(head, now),
  rest: `<dl class="d-grid">${grid.join("")}</dl>
    <div class="sched"><h4 class="h"><span>Today</span></h4>
      <div class="bar"${tinted ? ` role="img" aria-label="${esc(say)}"` : ""}>${wins}<i class="now" style="left:${m / 14.4}%"></i></div>
      <div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>${tinted ? TIER_KEY : ""}</div>`,
  sched: `<div class="slots">${hidden ? `<h4 class="h"><span>${list.length} of ${all.length} aimed at ${esc(myRegion())}</span><span>${showAllBtn()}</span></h4>` : ""}
      <table><tbody>${inline.map((r) => slotRow(r, next)).join("")}</tbody></table>${full}</div>`};
}
const SLOTS_INLINE = 3;
function slotRow(r, next) {
  const cls = r.air.on ? "cur" : r === next ? "next" : r.today.length ? "" : "idle";
  const to = r.e.targetLabel || r.e.target;
  return `<tr class="${cls}"><td>${hhmm(r.e.startUTC)}–${hhmm(r.e.endUTC)}</td>` +
    `<td>${flagHtml(ituFlag(r.e.itu), r.e.country)}${esc(r.e.station)}` +
    `<small>${esc([r.e.langLabel || r.e.lang, daysText(r.e)].filter(Boolean).join(" · "))}${to ? ` → ${esc(to)}` : ""}</small></td></tr>`;
}
// The whole schedule in the sheet, scrolled to what's on (or next)
function openSchedule() {
  if (!view.data) return;
  const {rows, next} = swPick(swView(view.data.shortwave).shown);
  $("sched-body").innerHTML = `<div class="slots"><table><tbody>${rows.map((r) => slotRow(r, next)).join("")}</tbody></table></div><p class="note">${dataLine()}</p>`;
  openTool("sched-pane", `Schedule · ${fmtKHz(view.k)}`);
  const cur = $("sched-body").querySelector("tr.cur, tr.next");
  if (cur) requestAnimationFrame(() => cur.scrollIntoView({block: "center"}));
}

// Distance and the great-circle bearing from the listener
const distDd = (to, km) => `<div><dt>Distance</dt><dd title="Great-circle bearing from you, for aiming an antenna">${esc(kmBearing(myPos, to, km))}</dd></div>`;

// ---- reminders: a broadcast that starts later today, while the page is open ----
const REM_MAX = 20, REM_STALE = 15 * 60000;
let reminders = store.get("rf919.reminders", []).filter((r) => r && r.k > 0 && r.at > Date.now() - REM_STALE);
const saveReminders = () => store.set("rf919.reminders", reminders);
// When the entry next starts (ms): startsIn counts whole minutes up from now, and starts fall on the minute
const startAt = (air, now) => Math.floor((now + air.startsIn * 60000) / 60000) * 60000;
function remindHtml(head, now) {
  if (head.air.on || head.air.startsIn == null || head.air.startsIn > 1440) return "";
  const at = startAt(head.air, now), set = reminders.some((r) => r.k === view.k && r.at === at);
  return `<button class="small toggle" type="button" data-act="remind" data-at="${at}" data-keep="remind" aria-pressed="${set}" ` +
    `title="A reminder when it starts, while this page is open">${set ? "Reminder set" : `Remind ${hhmm(head.e.startUTC)} UTC`}</button>`;
}
export function toggleReminder(k, at) {
  const i = reminders.findIndex((r) => r.k === k && r.at === at);
  if (i >= 0) { reminders.splice(i, 1); toast("Reminder cancelled", 2000); }
  else {
    if (reminders.length >= REM_MAX) reminders.shift();
    reminders.push({k, at, station: dossierName()});
    toast(`Reminder at ${minHHMM((at - utcDay(at)) / 60000)} UTC, while this page is open`, 3500);
    if (window.Notification && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }
  saveReminders();
  renderDossier();
}
export function checkReminders(now = Date.now()) {
  const due = reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  reminders = reminders.filter((r) => r.at > now);
  saveReminders();
  for (const r of due) {
    if (r.at < now - REM_STALE) continue;  // missed while the page was closed
    const text = `${r.station || "A broadcast"} starts now on ${fmtKHz(r.k)}`;
    toast(text, 8000, false, state.ok ? {label: "Tune", run: () => tuneKHz(r.k)} : {label: "Look up", run: () => lookUp(r.k)});
    if (document.hidden && window.Notification && Notification.permission === "granted") {
      try { new Notification("RF919 Companion", {body: text, tag: `rf919-${r.k}-${r.at}`}); } catch { /* Android wants a service worker */ }
    }
  }
  if (current === "explore" || current === "radio") renderDossier();
}

// Stations with their distance; nearest first with Near me
export function stationRows(list = view.data.stations) {
  const rows = list.map((s) => ({s, km: nearMe && myPos && s.lat != null && s.lon != null ? haversineKm(myPos, s) : null}));
  if (nearMe && myPos) rows.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return rows;
}
export function placeOf(s) {
  const seen = new Set();
  return [s.ubicacion, s.comuna, s.region].filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}
export const isRepeater = (s) => s.category === "amateur" && s.rxKHz && s.txKHz && Math.round(s.rxKHz) !== Math.round(s.txKHz);
export const dmrText = (s) => { const d = s.dmr || {}; return [d.colorCode != null && `CC${d.colorCode}`, d.slot != null && `TS${d.slot}`, d.tg && `TG${d.tg}`].filter(Boolean).join(" "); };
export const CATEGORY = {amateur: "Amateur", broadcast: "Broadcast", atc: "Air traffic", global: "Channel"};
export const tag = (text, cls = "") => `<span class="tag ${cls}">${esc(text)}</span>`;

// Badges; the hero shows tone, shift and DMR in its grid instead
export function stationTags(s, inGrid = false) {
  const tags = [];
  if (!inGrid && s.category === "amateur") {
    if (s.tono) tags.push(tag(`Tone ${s.tono}`));
    if (s.rxKHz && s.txKHz) tags.push(tag(fmtShift(s.rxKHz, s.txKHz)));
  }
  if (s.category === "amateur" && s.rxKHz && s.matchedOn && !s.matchedOn.includes("rx")) {
    tags.push(tag(`Input · listen on ${fmtKHz(Math.round(s.rxKHz))}`, "accent"));
  }
  if (!inGrid && s.category === "atc") tags.push(tag("ATC"));
  if (!inGrid && s.isDMR) tags.push(tag(`DMR ${dmrText(s)}`.trim(), "cool"));
  if (s.isEcholink) tags.push(tag("EchoLink", "accent"));
  return tags.join("");
}
// The station's page on radiomap.cl: as a chip in the card's actions, as a plain link in a list's line
export function stationLink(s, cls = "") {
  const url = radiomapUrl(s.url);
  return url ? `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener">radiomap ↗</a>` : "";
}

export function stationHero({s, km}) {
  const dd = (label, v) => v ? `<div><dt>${label}</dt><dd>${esc(v)}</dd></div>` : "";
  const grid = s.category === "amateur"
    ? [dd("Output", s.rxKHz && fmtKHz(Math.round(s.rxKHz))), dd("Input", isRepeater(s) && fmtKHz(Math.round(s.txKHz))),
       dd("Tone", s.tono), dd("Shift", isRepeater(s) && fmtShift(s.rxKHz, s.txKHz)), dd("Power", s.potencia && `${s.potencia} W`),
       dd("DMR", s.isDMR && (dmrText(s) || "yes"))]
    : [dd("Band", s.banda), dd("Region", s.region)];
  if (km != null) grid.push(distDd(s, km));
  const tags = stationTags(s, true), place = placeOf(s);
  view.links = stationLink(s, "tag");
  const cat = isRepeater(s) ? "Repeater" : CATEGORY[s.category] || "Station";
  view.flag = bgFlag(stationFlag(s));
  return {hero: `<div class="d-head"><span class="pill cat">${esc(cat)}</span><span class="d-sub">${esc(s.signal || "")}</span></div>
    <h3 class="d-name">${view.flag ? "" : flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile")}${esc(s.nombre || s.signal || "")}</h3>
    ${place.length || s.notes ? `<p class="d-meta">${esc([...place, s.notes].filter(Boolean).join(" · "))}</p>` : ""}${propBadge(stationEstimate(s, view.k), view.k)}`,
  rest: `<dl class="d-grid">${grid.join("")}</dl>
    ${tags ? `<div class="tags">${tags}</div>` : ""}`};
}

export function renderStations() {
  const box = $("stations"), d = view.data;
  const {shown: rows, hidden} = d && !view.err ? stationView() : {shown: [], hidden: 0};
  // Without shortwave the first station is the dossier's hero (which also says when everything is too far)
  const list = d && d.shortwave.length ? rows : rows.slice(1);
  const farLine = hidden && (d.shortwave.length || rows.length);
  if (!list.length && !farLine) { box.innerHTML = ""; box.dataset.n = ""; syncPanes(); return; }
  // A phone shows two rows and Show all: a third is taller than what's left of the screen under the card
  const shown = view.all ? list : list.slice(0, matchMedia("(max-width: 640px)").matches ? 2 : 3);
  box.dataset.label = d.shortwave.length ? "Stations" : "Also on";
  box.dataset.n = list.length || "";
  const scope = filtering() && radius ? `within ${radius} km` : located() ? "nearest first" : "";
  box.innerHTML = (scope ? `<h2 class="h"><span>${scope}</span></h2>` : "") +
    `<ul class="list${view.all ? " all" : ""}">${shown.map(stationRow).join("")}</ul>` +
    (list.length > shown.length ? `<button class="more" type="button" data-act="more">Show all ${list.length}</button>` : "") +
    (farLine ? `<p class="far">${hidden} farther than ${radius} km ${showAllBtn("Show them")}</p>` : "");
  syncPanes();
}

export function stationRow({s, km}) {
  const tags = stationTags(s), place = placeOf(s);
  return `<li class="st"><div class="st-main"><b>${flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile")}${esc(s.signal || "")}</b>` +
    `<span>${esc(s.nombre || "")}</span>` + (km != null ? `<span class="km">${Math.round(km).toLocaleString()} km</span>` : "") + `</div>` +
    `<div class="st-sub"><span>${esc([...place, s.notes].filter(Boolean).join(" · "))}</span>${stationLink(s)}</div>` +
    (tags ? `<div class="tags">${tags}</div>` : "") + `</li>`;
}

export function renderNearby() {
  const box = $("nearby");
  if (!view.near.length) { box.innerHTML = ""; syncPanes(); return; }
  const fol = following(), loc = located();
  // Near me: only neighbours with a station within the radius, or shortwave aimed at the listener
  const rows = loc ? view.near.filter((n) => !n.data || nearPasses(n.data)).slice(0, 6) : view.near;
  // Shortwave neighbours are filtered by where they're aimed, the rest by distance
  const scope = !loc ? "" : bandFor(view.k) === "SW" ? `to ${myRegion()}` : radius ? `≤ ${radius} km` : "near me";
  box.innerHTML = (scope ? `<h2 class="h"><span>${scope}</span></h2>` : "") +
    (rows.length ? `<ul class="list">${rows.map((n) => nearRow(n, fol, loc)).join("")}</ul>`
      : `<p class="of-msg">Nothing nearby within ${radius} km or aimed at ${esc(myRegion())}.</p>`);
  syncPanes();
}
export const nearPasses = (d) => stationView(d.stations, true).shown.length > 0 || d.shortwave.some((e) => aimedAt(e, myTargets));

// One line per nearby frequency: what's on air there now, else what's next, else its first (or nearest) station
export function nearRow(n, fol, loc = false) {
  const label = n.k >= 30000 ? (n.k / 1000).toFixed(3) : String(n.k);
  let name = "…", sub = "", flag = "", lamp = "none", est = null;
  const d = n.data;
  const sw = d ? swView(d.shortwave, loc).shown : [];
  if (d && sw.length) {
    const {on, head} = swPick(sw), e = head.e;
    name = e.station; flag = flagHtml(ituFlag(e.itu), e.country); lamp = head.air.on ? "on" : "";
    est = airEstimate(head, n.k);
    sub = [e.langLabel || e.lang,
      head.air.on ? `on air until ${minHHMM(hhmmMin(e.endUTC))}` : head.air.startsIn != null ? `next ${hhmm(e.startUTC)} UTC` : "",
      on.length > 1 ? `+${on.length - 1} on air` : sw.length > 1 ? `${sw.length} slots` : ""].filter(Boolean).join(" · ");
  } else if (d && d.stations.length) {
    const {s, km} = stationView(d.stations, loc).shown[0] || stationRows(d.stations)[0];
    name = s.nombre || s.signal; flag = flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile");
    est = stationEstimate(s, n.k);
    sub = [s.signal, placeOf(s)[1] || placeOf(s)[0], km != null && `${Math.round(km).toLocaleString()} km`,
      d.stations.length > 1 && `+${d.stations.length - 1} more`].filter(Boolean).join(" · ");
  } else if (d) name = "—";
  return `<li><button class="near-row${d ? "" : " loading"}" type="button" data-go="${n.k}" aria-label="${fol ? "Tune to" : "Look up"} ${fmtKHz(n.k)}${d ? ": " + esc(name) : ""}${rowSay(est)}">` +
    `<span class="nf">${label}</span><span class="nn"><b>${flag}${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>` +
    `${rowBars(est)}<span class="dot ${lamp}"></span></button></li>`;
}

// ---- Discover (Explore): what's on air across a meter band, and the stations near the listener ----
// One file per frequency, so nothing is fetched until a band is tapped. Scans are kept for the session; on-air states
// and the Near me filters are worked out again from what was fetched. busy: the band being scanned
const DISC_ROWS = 30;
export const disc = {mode: store.get("rf919.disc", "sw"), meter: store.get("rf919.discmeter", null), band: store.get("rf919.discband", "FM"),
  kind: "all", win: 0, aimed: false, all: false, sw: new Map(), near: new Map(), busy: null, best: store.get("rf919.discbest", false)};
const meterKs = (m) => { const [, lo, hi] = SW_METERS.find(([x]) => x === m); return view.idx ? stripTicks(view.idx.freqs, lo, hi) : []; };
const bandKs = (b) => view.idx ? view.idx.freqs.filter((k) => bandFor(k) === b) : [];
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : `${dur(m)} ago`; };

export function renderDiscover() {
  if (!$("discover")) return;
  if (!disc.meter && view.idx) disc.meter = SW_METERS.map(([m]) => [m, meterKs(m).length]).sort((a, b) => b[1] - a[1])[0][0];
  disc.meter ||= "31m";
  const sw = disc.mode === "sw";
  $("disc-sw").hidden = !sw; $("disc-near").hidden = sw;
  document.querySelectorAll('#disc-seg input').forEach((i) => { i.checked = i.value === disc.mode; });
  const count = (n) => view.idx ? `<small>${n}</small>` : "";
  // Rebuilt only when it changes (the minute's refresh mustn't take the focus away), with the picked band in view
  const meters = $("disc-meters"), html = `<legend>Meter band</legend>` + SW_METERS.filter(([m]) => !view.idx || meterKs(m).length).map(([m]) =>
    `<label><input type="radio" name="discmeter" value="${m}"${m === disc.meter ? " checked" : ""}><span>${m}${count(meterKs(m).length)}</span></label>`).join("");
  if (meters.dataset.html !== html) {
    meters.innerHTML = meters.dataset.html = html;
    const on = meters.querySelector("input:checked");
    if (on && sw) {
      const row = $("disc-row"), s = row.getBoundingClientRect(), l = on.parentElement.getBoundingClientRect();
      row.scrollLeft += l.left - s.left - (s.width - l.width) / 2;
    }
  }
  $("disc-aimed-row").hidden = !myPos;
  $("disc-aimed-name").textContent = myRegion();
  $("disc-aimed").checked = disc.aimed;
  $("disc-best-row").hidden = !canEstimate();
  $("disc-best").checked = disc.best;
  document.querySelectorAll("#disc-win input").forEach((i) => { i.checked = +i.value === disc.win; });
  const bands = ["FM", "AM", "VHF", "UHF", "AIR"].filter((b) => !view.idx || bandKs(b).length);
  const bandBox = $("disc-bands"), bandHtml = `<legend>Band</legend>` + bands.map((b) =>
    `<label><input type="radio" name="discband" value="${b}"${b === disc.band ? " checked" : ""}><span>${b}${count(bandKs(b).length)}</span></label>`).join("");
  if (bandBox.dataset.html !== bandHtml) bandBox.innerHTML = bandBox.dataset.html = bandHtml;
  $("disc-kind").value = disc.kind;
  $("disc-radius").innerHTML = RADII.map((r) => `<option value="${r}"${r === radius ? " selected" : ""}>${r ? `Within ${r} km` : "Any distance"}</option>`).join("");
  const scanned = (sw ? disc.sw.get(disc.meter) : disc.near.get(disc.band));
  if (jobs.disc) return;  // a scan is running: its progress bar stays
  const box = $("disc-results");
  if (!scanned) {
    box.innerHTML = `<p class="hint">${sw ? "Tap a band to see who's on air now, from the EiBi schedules." : "Tap a band to list its stations nearest to you."} ` +
      `It fetches one file per frequency from radiomap.cl.</p>`;
    return;
  }
  const rows = sw ? discSwRows(scanned.pairs) : discNearRows(scanned.pairs), shown = disc.all ? rows : rows.slice(0, DISC_ROWS);
  const failed = scanned.pairs.filter(([, d]) => d === null).length;
  box.innerHTML = (rows.length ? `<ul class="list">${shown.join("")}</ul>` : `<p class="of-msg">${sw ? `Nothing on air on ${disc.meter}${disc.win ? " or starting soon" : ""}` +
      `${discTargets() ? ` aimed at ${esc(myRegion())}` : ""}.` : `No ${disc.band} station${radius ? ` within ${radius} km` : ""}.`}</p>`) +
    (rows.length > shown.length ? `<button class="more" type="button" data-act="disc-all">Show all ${rows.length}</button>` : "") +
    `<p class="note">${rows.length} ${sw ? "on air" + (disc.win ? " or soon" : "") : "stations"} · scanned ${ago(scanned.at)}${failed ? ` · ${failed} failed, tap the band to retry` : ""}</p>`;
}
const discTargets = () => disc.aimed && myPos ? myTargets : null;
function discSwRows(pairs) {
  const targets = discTargets(), best = disc.best && canEstimate();
  const score = (r) => { const est = airEstimate(r, r.k); return est ? est.score : -Infinity; };
  return swOnAir(pairs, {win: disc.win, targets}).map((r) => ({...r, score: best ? score(r) : 0}))
    .sort((a, b) => b.score - a.score || b.air.on - a.air.on || (a.air.startsIn ?? 0) - (b.air.startsIn ?? 0) || a.k - b.k)
    .map(({k, data}) => nearRow({k, data}, false, !!targets));
}
function discNearRows(pairs) {
  return nearestStations(pairs, {band: disc.band, kind: disc.kind, pos: myPos, radius}).map(({k, s, km}) => {
    const name = s.nombre || s.signal || "", label = k >= 30000 ? (k / 1000).toFixed(3) : String(k);
    const sub = [s.nombre && s.signal, isRepeater(s) && `repeater ${fmtShift(s.rxKHz, s.txKHz)}`, placeOf(s)[0],
      km != null && `${Math.round(km).toLocaleString()} km`].filter(Boolean).join(" · ");
    return `<li><button class="near-row" type="button" data-go="${k}" aria-label="Look up ${fmtKHz(k)}: ${esc(name)}">` +
      `<span class="nf">${label}</span><span class="nn"><b>${flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile")}${esc(name)}</b>` +
      `${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="dot none"></span></button></li>`;
  });
}
// A band was tapped: fetch it unless it's already held whole. Tapping it again retries what failed
function discPicked() {
  const sw = disc.mode === "sw", key = sw ? disc.meter : disc.band, held = (sw ? disc.sw : disc.near).get(key);
  if (!held || held.pairs.some(([, d]) => d === null)) { if (disc.busy !== key) discScan(); return; }
  // Its list is already there: drop a scan of another band, whose end shows it (renderDiscover waits for the job)
  disc.busy = null;
  if (jobs.disc) jobs.disc.abort();
}
export async function discScan() {
  const sw = disc.mode === "sw", box = $("disc-results"), key = sw ? disc.meter : disc.band;
  disc.busy = key;
  try {
    // Another band may be tapped during either wait: it takes over from here
    if (!sw && !myPos) { try { await locate(); } catch { if (radius) return; } }
    if (disc.busy !== key) return;
    const idx = await radiomapIndex(box);
    if (!idx || disc.busy !== key) return;
    view.idx ||= idx;
    const ks = sw ? meterKs(key) : bandKs(key);
    if (!ks.length) { box.innerHTML = `<p class="hint">radiomap.cl has nothing on ${key}.</p>`; return; }
    const got = await fetchAll(ks, box, "disc");
    if (!got) { renderDiscover(); return; }
    (sw ? disc.sw : disc.near).set(key, {at: Date.now(), pairs: ks.map((k, i) => [k, got[i]])});
    disc.all = false;
    renderDiscover();
  } finally { if (disc.busy === key) disc.busy = null; }
}

// Asks for the position once more and keeps it; rejects (after a toast) when it isn't available
export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { toast("Location isn't available here", 3500, true); reject(new Error("no geolocation")); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      // ~1 km is plenty to sort stations, and is all that gets stored
      myPos = {lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2)};
      myTargets = targetsAt(myPos);
      store.set("rf919.pos", myPos);
      renderSwChips();
      renderConditions();
      resolve(myPos);
    }, (e) => { toast(`Location: ${e.message || "not allowed"}`, 4000, true); reject(e); }, {maximumAge: 600000, timeout: 15000});
  });
}
export function toggleNearMe() {
  const set = (on) => { nearMe = on; view.showAll = false; store.set("rf919.nearme", on); renderView(); if (view.k !== null) loadNearby(view.k); };
  if (nearMe) set(false);
  else locate().then(() => set(true), () => {});
}
export function tickClock() {
  const d = new Date();
  $("clock").innerHTML = `<b>${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}</b> <small>UTC</small>`;
}

// What ran at load in the single-script page, in the same order; app.js calls it once every module is loaded
export function init() {

  $("search").addEventListener("submit", (e) => {
    e.preventDefault();
    // A frequency, else the first station whose name matches (find.js)
    const k = parseFreqInput($("q").value) ?? firstHit();
    if (k === null) { toast("Type a frequency (9580, 9.58, 146.73) or a station's name", 4000, true); return; }
    $("q").value = ""; $("q").blur(); renderResults();
    openFrom($("q"), k);
  });
  $("q-clear").addEventListener("click", () => { $("q").value = ""; renderResults(); $("q").focus(); });
  renderPicks();
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "infopane") { infoPane = t.value; store.set("rf919.infopane", t.value); syncPanes(); return; }
    if (t.matches('select[data-act="radius"]')) {
      radius = +t.value;
      store.set("rf919.radius", radius);
      renderView();
      renderDiscover();
    } else if (t.closest("#discover")) {
      if (t.name === "disc") { disc.mode = t.value; store.set("rf919.disc", t.value); }
      else if (t.name === "discmeter") { disc.meter = t.value; store.set("rf919.discmeter", t.value); }
      else if (t.name === "discband") { disc.band = t.value; store.set("rf919.discband", t.value); }
      else if (t.id === "disc-kind") disc.kind = t.value;
      else if (t.name === "discwin") disc.win = +t.value;
      else if (t.id === "disc-aimed") disc.aimed = t.checked;
      else if (t.id === "disc-best") { disc.best = t.checked; store.set("rf919.discbest", t.checked); }
      disc.all = false;
      renderDiscover();
      if (t.name === "discmeter" || t.name === "discband") discPicked();
    }
  });
  // The band already highlighted: a radio fires no change for it. On a new pick click comes first, before the state moves
  $("discover").addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches('input[name="discmeter"], input[name="discband"]') && t.value === (t.name === "discmeter" ? disc.meter : disc.band)) discPicked();
  });
  // The dial: swipe the looked-up frequency (left = up), drag or tap the band strip
  swipeTune($("dossier"), (dir, seek) => {
    if (view.follow || !view.idx || view.k === null) return;
    const to = stepKnown(view.idx.freqs, view.k, dir, seek ? 10 : 1);
    if (to != null) lookUp(to);
  }, {only: ".d-dial"});
  wireStrip($("dossier"));
  renderBands();
  renderDiscover();
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-go], [data-look], [data-act]");
    if (!t) return;
    if (t.dataset.go) goTo(+t.dataset.go, t);
    else if (t.dataset.look) openFrom(t, +t.dataset.look);
    else if (t.dataset.act === "more") { view.all = true; renderStations(); }
    else if (t.dataset.act === "dial") { if (t.dataset.to) openFrom(t, +t.dataset.to); }
    else if (t.dataset.act === "pin") togglePin(view.k);
    else if (t.dataset.act === "logk") showLogFor(+t.dataset.k);
    else if (t.dataset.act === "share") shareFreq();
    else if (t.dataset.act === "sched") openSchedule();
    else if (t.dataset.act === "prop") openProp();
    else if (t.dataset.act === "prop-locate") askPosition();
    else if (t.dataset.act === "remind") toggleReminder(view.k, +t.dataset.at);
    else if (t.dataset.act === "disc-all") { disc.all = true; renderDiscover(); }
    else if (t.dataset.act === "nearme") toggleNearMe();
    else if (t.dataset.act === "showall") { view.showAll = true; renderView(); }
    else if (t.dataset.act === "refilter") { view.showAll = false; renderView(); }
    else if (t.dataset.act === "tunehere") tuneHere();
    else if (t.dataset.act === "addmem") addMem([{band: bandFor(view.k), kHz: view.k, ch: null, name: dossierName()}]);
    else if (t.dataset.act === "storehere") storeHere();
    else if (t.dataset.act === "connect") startBle();
    else if (t.dataset.act === "noradio") startNoRadio();
  });
  // A flag the CDN can't serve becomes the globe
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains("flag")) img.outerHTML = globeSvg(img.alt);
  }, true);
  window.addEventListener("hashchange", () => route({animate: true}));
  // Tabs switch at once (no wait for hashchange) and still add a history entry, so Back returns to the previous tab
  $("tabbar").addEventListener("click", (e) => {
    const a = e.target.closest("[data-tab]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    // The small tab bar (scrolled down): a tap brings the whole bar back
    if (document.body.classList.contains("bars-min")) { setBarsMin(false); return; }
    // Tap the open tab again: Explore's detail goes back to its home, otherwise back to the top
    if (a.dataset.tab === current) { if (current === "explore" && inDetail()) exploreBack(); else window.scrollTo({top: 0, behavior: "smooth"}); return; }
    try { history.pushState(null, "", `#${a.dataset.tab}`); } catch { /* sandboxed */ }
    vt(() => go(a.dataset.tab), {dir: tabDir(a.dataset.tab)});
  });
  // Keep the on-air state, the "now" marker and the current slot moving
  setInterval(() => {
    if (document.hidden) return;
    if (view.data) renderView();
    if (current === "explore") renderDiscover();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    checkReminders();
    if (!document.hidden && view.data) renderView();
  });
  // Reminders run while the page is open, hidden or not (a background tab still ticks about once a minute)
  checkReminders();
  setInterval(checkReminders, 20000);
  tickClock();
  setInterval(tickClock, 15000);
}
