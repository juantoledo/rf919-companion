import {NameIndex, norm} from "../names.js";
import {aimedAt, flagHtml, fmtKHz, hhmmMin, minHHMM, sampleFreqs, swAir} from "../radiomap.js";
import {HF_MAX, MW_MAX, bestRange, rankSuggestions} from "../propagation.js";
import {SW_METERS, pool} from "../memories.js";
import {$, current, esc, inDetail} from "./shell.js";
import {icon, keepFocus, myPos, myTargets, pinned, rm, store, view} from "./radio.js";
import {fetchAll, jobs} from "./memories.js";
import {canEstimate, rowBars, rowSay, solarKnown, stationEstimate, swEstimate, wxNow as wx} from "./reception.js";

// ---- Explore's home: search by station name, suggestions, and pins that say when they're on ----
// Every frequency file the page reads (rm.onData) teaches the name index and joins `known`, this session's lookups,
// which the suggestions and the pins' lamps are worked out from. Nothing is fetched for them but the pins, and a few
// rounds per session of small files from across the bands when too little is known to fill the row
let names = new NameIndex(), saveTimer = 0, frame = 0;
const known = new Map();
const save = () => store.set("rf919.names", {version: view.idx ? view.idx.version : store.get("rf919.names", {}).version, ...names.toJSON()});
function learn(k, data) {
  names.add(k, data);
  if (data) known.set(k, data);
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 3000);
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { if (current === "explore" && !inDetail()) renderPicks(); });
}
// radiomap.cl published a new index: the names stay, but which frequencies were read is no longer the whole story
export function indexVersion(v) {
  const s = store.get("rf919.names", null);
  if (s && s.version && s.version !== v) { names.seen.clear(); save(); }
}

// ---- search by name ----
const label = (k) => k >= 30000 ? (k / 1000).toFixed(3) : String(k);
const isFreqText = (q) => /^[\d.,\s]*(k|khz|m|mhz)?$/i.test(q);
// Is the station called `name` on air on k now (from what's known)?
function onAirAs(k, name) {
  const d = known.get(k);
  if (!d) return false;
  if (d.shortwave.length) return d.shortwave.some((e) => norm(e.station) === norm(name) && swAir(e).on);
  return d.stations.length > 0;  // FM, AM and the rest broadcast around the clock
}
let hits = [];
export function renderResults() {
  const box = $("q-results"), q = $("q").value.trim();
  if (q.length < 2 || isFreqText(q)) { box.hidden = true; box.innerHTML = ""; hits = []; return; }
  hits = names.search(q, 8);
  const total = view.idx ? view.idx.freqs.length : 0, read = view.idx ? view.idx.freqs.filter((k) => names.seen.has(k)).length : names.seen.size;
  const more = total && read < total;
  const chip = (h, k) => { const on = onAirAs(k, h.name);
    return `<button class="chip" type="button" data-look="${k}" aria-label="${esc(h.name)} on ${fmtKHz(k)}${on ? ", on air" : ""}">` +
      `${on ? `<span class="lit" aria-hidden="true"></span>` : ""}${label(k)}</button>`; };
  box.innerHTML = (hits.length ? `<ul class="qr-list">${hits.map((h) => `<li class="qr"><span class="qr-name">${flagHtml(h.flag, h.flag ? "" : "International")}` +
      `<b>${esc(h.name)}</b></span><span class="qr-ks">${h.ks.slice(0, 6).map((k) => chip(h, k)).join("")}` +
      `${h.ks.length > 6 ? `<small>+${h.ks.length - 6}</small>` : ""}</span></li>`).join("")}</ul>` : "") +
    `<p class="qr-foot" role="status">${hits.length ? `${hits.length} station${hits.length === 1 ? "" : "s"}` : `No station called “${esc(q)}” yet`}` +
    (more ? ` · from ${read} of ${total} frequencies <button class="small" type="button" data-act="names-all">Search all</button>` : "") + `</p>` +
    `<div id="qr-job"></div>`;
  box.hidden = false;
}
// Enter on a name: the first station's first frequency
export const firstHit = () => hits.length ? hits[0].ks[0] : null;
// Reads every frequency file not read yet (about 1 MB in all), with a progress bar and Cancel
async function searchAll() {
  const idx = view.idx || await rm.index().catch(() => null);
  if (!idx) return;
  const ks = idx.freqs.filter((k) => !names.seen.has(k));
  const got = await fetchAll(ks, $("qr-job"), "names");  // rm.get: onData learns each one
  save();
  if (got) renderResults();
}

// ---- Under the search: the pins, then what can probably be heard now, best first, whatever the band ----
const SUGGEST_MAX = 8, FILL_FILES = 40, FILL_ROUNDS = 3;
let rounds = 0, filling = false;
// The best thing to hear on each frequency read so far. FM and up have no estimate, so nothing to rank them by
function suggestionRows(now, ranked) {
  const pins = pinned(), rows = [], top = (a, b) => ranked ? (b.est ? b.est.score : -Infinity) - (a.est ? a.est.score : -Infinity) : b.aimed - a.aimed;
  for (const [k, d] of known) {
    if (pins.includes(k) || k >= HF_MAX) continue;
    if (d.shortwave.length) {
      const on = d.shortwave.map((e) => ({e, air: swAir(e, now)})).filter((x) => x.air.on)
        .map((x) => ({...x, est: ranked ? swEstimate(x.e, k, now) : null, aimed: aimedAt(x.e, myTargets)}));
      if (!on.length) continue;
      const {e, air, est, aimed} = on.sort(top)[0], name = e.station || fmtKHz(k);
      rows.push({k, key: norm(name), name, est, aimed, left: air.endsIn, sub: `until ${minHHMM(hhmmMin(e.endUTC))} UTC`});
    } else if (ranked && k < MW_MAX && d.stations.length) {
      const {s, est} = d.stations.map((s) => ({s, est: stationEstimate(s, k, now)})).sort(top)[0], name = s.nombre || s.signal || fmtKHz(k);
      rows.push({k, key: norm(name), name, est, aimed: false, left: Infinity, sub: ""});
    }
  }
  return rows;
}
const pinChip = (k) => {
  // A pin says when it's on: a lamp on air, "20m" when it starts within the hour
  const st = pinState(k), lamp = st && st.on ? `<span class="lit" aria-hidden="true"></span>` : "";
  const soon = st && !st.on ? `<small class="pin-soon">${st.startsIn}m</small>` : "";
  const say = st ? (st.on ? ", on air" : `, on in ${st.startsIn} min`) : "";
  return `<button class="chip pinned" type="button" data-look="${k}" aria-label="Pinned: ${fmtKHz(k)}${say}">${icon("pin")}${lamp}${label(k)}<small>${k >= 30000 ? "MHz" : "kHz"}</small>${soon}</button>`;
};
const suggestChip = (r) => `<button class="chip sg" type="button" data-look="${r.k}" aria-label="${esc(r.name)}, ${fmtKHz(r.k)}${r.sub ? `, ${esc(r.sub)}` : ""}${rowSay(r.est)}">` +
  `${rowBars(r.est)}${label(r.k)}<small>${esc(r.name)}</small></button>`;
export function renderPicks() {
  const box = $("picks");
  if (!box) return;
  const pins = pinned(), ranked = canEstimate(), rows = rankSuggestions(suggestionRows(Date.now(), ranked), {ranked, max: SUGGEST_MAX});
  if (rows.length < SUGGEST_MAX) fillPicks();
  const ask = !myPos && solarKnown() ? `<button class="chip" type="button" data-act="prop-locate">Rank by my location</button>` : "";
  box.hidden = !pins.length && !rows.length && !ask;
  keepFocus(box, pins.map(pinChip).join("") + rows.map(suggestChip).join("") + ask);
  $("x-hint").hidden = !!(pins.length || rows.length);  // nothing to offer yet: how to type a frequency
}
// Where a station worth suggesting is likeliest: medium wave and the meter bands open now (all of them, not knowing where you are)
function fillRanges() {
  const open = canEstimate() ? bestRange(myPos, wx(), Date.now()) : null;
  const meters = SW_METERS.filter(([, lo, hi]) => !open || (hi >= open.lo * 1000 && lo <= open.hi * 1000));
  return [[150, MW_MAX - 1], ...meters.map(([, lo, hi]) => [lo, hi])];
}
// While Explore is open and online, a few rounds per session of frequencies from across the bands, until the row is full
async function fillPicks() {
  // not while a scan or a list builder is fetching: they come first
  if (filling || rounds >= FILL_ROUNDS || !view.idx || current !== "explore" || !navigator.onLine || Object.values(jobs).some(Boolean)) return;
  rounds++;
  const ks = sampleFreqs(view.idx.freqs.filter((k) => !known.has(k)), fillRanges(), FILL_FILES);
  if (!ks.length) return;
  filling = true;
  try { await pool(ks, 4, (k) => rm.get(`freq/${k}.json`)); } finally { filling = false; }
  renderPicks();
}

// ---- pins: a lamp when on air, "in 20m" when starting within the hour ----
const asked = new Set();
export function pinState(k, now = Date.now()) {
  const d = known.get(k);
  if (!d) { if (!asked.has(k)) { asked.add(k); rm.lookup(k).catch(() => {}); } return null; }  // the lookup teaches `known`
  if (!d.shortwave.length) return d.stations.length ? {on: true} : null;
  const airs = d.shortwave.map((e) => swAir(e, now));
  if (airs.some((a) => a.on)) return {on: true};
  const soon = Math.min(...airs.map((a) => a.startsIn ?? Infinity));
  return soon <= 60 ? {on: false, startsIn: soon} : null;
}

export function init() {
  names = NameIndex.fromJSON(store.get("rf919.names", null));
  rm.onData = learn;
  try { localStorage.removeItem("rf919.recent"); } catch { /* storage unavailable: nothing to tidy */ }  // what recent lookups left behind
  asked.clear(); renderPicks();  // the pins asked before the hook was in place
  $("q").addEventListener("input", renderResults);
  // ↓ from the field to the first result; ↑↓ between the results' frequencies, Esc back to the field
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { const f = $("q-results").querySelector("[data-look]"); if (f) { e.preventDefault(); f.focus(); } }
  });
  $("q-results").addEventListener("keydown", (e) => {
    const all = [...$("q-results").querySelectorAll("[data-look]")], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); (all[i + 1] || all[i]).focus(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); (i ? all[i - 1] : $("q")).focus(); }
    else if (e.key === "Escape") { e.preventDefault(); $("q").focus(); }
  });
  $("q-results").addEventListener("click", (e) => {
    const b = e.target.closest('[data-act="names-all"]');
    if (!b || b.disabled) return;
    b.disabled = true; b.textContent = "Searching…";  // the results come back when it's done (or cancelled)
    searchAll().finally(() => { if (b.isConnected) renderResults(); });
  });
  setInterval(() => { if (current === "explore" && !inDetail() && !document.hidden) renderPicks(); }, 60000);
  Object.assign(window, {names});  // for the browser checks and the console
}
