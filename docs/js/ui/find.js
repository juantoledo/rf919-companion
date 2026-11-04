import {NameIndex, norm} from "../names.js";
import {aimedAt, flagHtml, fmtKHz, hhmmMin, ituFlag, minHHMM, stripTicks, swAir} from "../radiomap.js";
import {SW_METERS, pool} from "../memories.js";
import {$, current, esc, inDetail} from "./shell.js";
import {disc, keepFocus, located, myRegion, myTargets, nameOf, pinned, renderRecent, rm, store, view} from "./radio.js";
import {fetchAll, jobs} from "./memories.js";

// ---- Explore's home: search by station name, On air now, and pins that say when they're on ----
// Every frequency file the page reads (rm.onData) teaches the name index and joins `known`, this session's lookups,
// which On air now and the pins' lamps are worked out from. Nothing is fetched for them but the pins, and once per
// session the busiest meter band (a few dozen small files) when too little is known to fill the shelf
let names = new NameIndex(), saveTimer = 0, frame = 0;
const known = new Map();
const save = () => store.set("rf919.names", {version: view.idx ? view.idx.version : store.get("rf919.names", {}).version, ...names.toJSON()});
function learn(k, data) {
  names.add(k, data);
  if (data) known.set(k, data);
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 3000);
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { if (current === "explore" && !inDetail()) { renderOnAir(); renderRecent(); } });
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

// ---- On air now: a shelf of cards under the bands ----
let filled = false;
function onAirRows(now = Date.now()) {
  const pins = pinned(), recent = store.get("rf919.recent", []), rows = [], loc = located();
  const add = (k, why) => {
    const d = known.get(k);
    if (!d || rows.some((r) => r.k === k)) return;
    if (d.shortwave.length) {
      const on = d.shortwave.map((e) => ({e, air: swAir(e, now)})).filter((x) => x.air.on);
      const mine = loc ? on.filter((x) => aimedAt(x.e, myTargets)) : on;
      if (!on.length || (why === "sw" && loc && !mine.length)) return;
      const {e, air} = (mine[0] || on[0]);
      rows.push({k, why, aimed: !!mine.length && loc, name: e.station || fmtKHz(k), flag: ituFlag(e.itu) || "", country: e.country || "",
        sub: `until ${minHHMM(hhmmMin(e.endUTC))} UTC`, left: air.endsIn});
    } else if (d.stations.length && why !== "sw") {
      const s = d.stations[0];
      rows.push({k, why, aimed: false, name: nameOf(d) || fmtKHz(k), flag: s.category === "global" ? "" : "cl", country: s.category === "global" ? "Worldwide" : "Chile",
        sub: why === "pin" ? "pinned" : "recent", left: Infinity});
    }
  };
  for (const k of pins) add(k, "pin");
  for (const k of recent) add(k, "recent");
  for (const k of known.keys()) add(k, "sw");
  const rank = (r) => r.why === "pin" ? 0 : r.aimed ? 1 : r.why === "recent" ? 2 : 3;
  return rows.sort((a, b) => rank(a) - rank(b) || b.left - a.left || a.k - b.k).slice(0, 8);
}
export function renderOnAir() {
  const box = $("onair");
  if (!box) return;
  const rows = onAirRows();
  if (rows.filter((r) => r.why === "sw").length < 4) fillOnAir();
  box.hidden = !rows.length;
  keepFocus(box, !rows.length ? "" : `<h2 class="h" id="g-onair"><span>On air now</span><span>${located() ? `to ${esc(myRegion())}` : "tap to listen"}</span></h2>` +
    `<div class="oa-row">${rows.map((r) => `<button class="oa-card" type="button" data-look="${r.k}" aria-label="${esc(r.name)}, ${fmtKHz(r.k)}, ${esc(r.sub)}">` +
      `<span class="oa-top">${flagHtml(r.flag, r.country)}<span class="oa-f">${label(r.k)}</span>${r.why === "pin" ? `<svg class="ico oa-pin" aria-hidden="true"><use href="#i-pin"/></svg>` : ""}</span>` +
      `<b>${esc(r.name)}</b><small>${esc(r.sub)}</small></button>`).join("")}</div>`);
}
// Once per session, while Explore is open and online: the busiest meter band's frequencies, a few at a time
async function fillOnAir() {
  // not while a scan or a list builder is fetching: they come first
  if (filled || !view.idx || current !== "explore" || !navigator.onLine || Object.values(jobs).some(Boolean)) return;
  filled = true;
  const m = SW_METERS.find(([x]) => x === (disc.meter || "31m")) || SW_METERS[0];
  const ks = stripTicks(view.idx.freqs, m[1], m[2]).filter((k) => !known.has(k)).slice(0, 60);
  await pool(ks, 4, (k) => rm.get(`freq/${k}.json`));
  renderOnAir();
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
  asked.clear(); renderRecent();  // the pins asked before the hook was in place
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
  setInterval(() => { if (current === "explore" && !inDetail() && !document.hidden) renderOnAir(); }, 60000);
  Object.assign(window, {names});  // for the browser checks and the console
}
