import {pad2} from "../protocol.js";
import {EMPTY_FREQ, FLAG_CDN, RADIOMAP_SITE, RadioMap, aimedAt, daysText, dur, flagHtml, fmtKHz, fmtShift, globeSvg, haversineKm, hhmmMin, ituFlag, minHHMM, nearby, parseFreqInput, radiomapUrl, span, stationFlag, swAir, targetsAt, targetsName, todayWindows, utcDay} from "../radiomap.js";
import {addToList, bandFor} from "../memories.js";
import {errText} from "../link.js";
import {$, current, esc, go, goTo, log, lookUp, renderMini, route, state, toast, tuneHere} from "./shell.js";
import {addMem, canStoreHere, renderStoreHere, renderSwChips, storeHere} from "./memories.js";
import {startBle, startDemo} from "./more.js";

// ---- What's on a frequency (radiomap.cl) ----
// Per-viewer conveniences only; the page works the same when storage is unavailable
export const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
export const rm = new RadioMap();
// Memories: the list to store, this app's record of what it stored per band:channel, and the running job
export const mem = {list: addToList([], store.get("rf919.memlist", []).filter((e) => e && e.band && e.kHz > 0)).list,
  record: store.get("rf919.memories", {}), run: null, pos: -1, step: "", t0: 0, from: 0, fail: null, check: null,
  job: null, picks: {sw: null, near: null}, test: null};
// radioK: where the radio is; k: what the page shows; follow: k tracks the radio (a search pins k instead).
// near: nearby frequencies with their lookups; fresh: scroll the schedule to "now" on the next render
// flag: the flag-icons key of the station the card headlines (its background), "" for none
export const view = {radioK: null, pendingK: undefined, k: null, follow: true, data: null, err: null, near: [], idx: null,
  all: false, showAll: false, fresh: false, timer: 0, unit: "MHz", flag: "", radioName: ""};
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

// Debounced, so a SCAN or seek sweep only looks up the frequency it settles on
export function radioFreq(k) {
  if (k === view.pendingK) return;
  view.pendingK = k;
  clearTimeout(view.timer);
  view.timer = setTimeout(() => {
    view.radioK = k;
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

export async function show(k) {
  Object.assign(view, {k, data: null, err: null, near: [], all: false, showAll: false, fresh: true});
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

export async function loadNearby(k) {
  try {
    const idx = await rm.index();
    if (view.k !== k) return;
    view.idx = idx;
    // Filtering by location hides some neighbours, so look at more of them
    const near = view.near = nearby(idx.freqs, k, located() ? 14 : 6).map((f) => ({k: f, data: null}));
    renderNearby();
    await Promise.all(near.map(async (n) => {
      try { n.data = await rm.lookup(n.k); } catch { n.data = EMPTY_FREQ; }
      if (view.near === near) renderNearby();
    }));
  } catch { /* nearby is optional */ }
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
}

export function renderDossier() {
  const box = $("dossier"), old = box.querySelector(".slots-box"), top = old ? old.scrollTop : 0;
  box.innerHTML = dossierHtml();
  box.hidden = !box.innerHTML;
  // One card: the radio's readout over what's on its frequency, the station's flag behind both
  const now = $("now");
  now.hidden = box.hidden && $("readout").hidden;
  now.style.setProperty("--flag", view.flag ? `url("${FLAG_CDN}${view.flag}.svg")` : "none");
  now.classList.toggle("flagged", !!view.flag);
  const slots = box.querySelector(".slots-box");
  if (!slots) return;
  if (view.fresh) {
    const target = slots.querySelector("tr.cur") || slots.querySelector("tr.next");
    slots.scrollTop = target ? target.offsetTop : 0;
    view.fresh = false;
  } else slots.scrollTop = top;
}

export function dossierHtml() {
  const k = view.k;
  view.flag = "";
  if (k === null) {
    // Radio: waiting for the radio (the connect card covers "not connected"); Explore: how to start
    if (view.follow) return state.ok ? `<div class="d-empty"><p class="empty-t">Listening…</p><p class="empty-d">Waiting for the radio's frequency.</p></div>` : "";
    return introHtml();
  }
  // On Radio the readout above shows the frequency; Explore shows the one looked up in the same big digits
  const freq = following() ? "" : `<p class="d-freq">${k >= 30000 ? (k / 1000).toFixed(3) : k}<small>${k >= 30000 ? "MHz" : "kHz"}</small></p>`;
  // The actions don't wait for radiomap.cl: Store here and + Memory work whatever it answers
  if (view.err) return freq + `<p class="of-msg">radiomap.cl unreachable (${esc(errText(view.err))})</p>` + actionsHtml();
  if (!view.data) return freq + `<div class="skeleton" role="status" aria-label="Looking up ${fmtKHz(k)}"><i></i><i></i><i></i></div>` + actionsHtml();
  const {stations, shortwave} = view.data;
  let body;
  if (shortwave.length) body = swHtml(shortwave);
  else if (stations.length) {
    const {shown, hidden} = stationView();
    body = shown.length ? stationHero(shown[0])
      : `<div class="d-empty"><p class="empty-t">Nothing near</p><p class="empty-d">No station on ${fmtKHz(k)} within ${radius} km; ` +
        `${hidden} farther away.</p><div class="intro-act">${showAllBtn(`Show ${hidden === 1 ? "it" : `all ${hidden}`}`)}</div></div>`;
  } else body = `<div class="d-empty"><p class="empty-t">Nothing known</p><p class="empty-d">radiomap.cl has no station on ${fmtKHz(k)}.</p></div>`;
  return freq + body + actionsHtml();
}

// Recent lookups: chips under Explore's search, newest first
const RECENT_MAX = 8;
export function addRecent(k) {
  store.set("rf919.recent", [k, ...store.get("rf919.recent", []).filter((r) => r !== k)].slice(0, RECENT_MAX));
  renderRecent();
}
export function renderRecent() {
  const list = store.get("rf919.recent", []).filter((k) => k > 0), box = $("recent");
  box.hidden = !list.length;
  box.innerHTML = list.map((k) => `<button class="chip" type="button" data-look="${k}" aria-label="Look up ${fmtKHz(k)}">` +
    `${k >= 30000 ? (k / 1000).toFixed(3) : k}<small>${k >= 30000 ? "MHz" : "kHz"}</small></button>`).join("");
}

export function introHtml() {
  const examples = [[9580, "9580"], [11620, "11620"], [146730, "146.730"], [101300, "101.3"], [118100, "118.1"]];
  return `<div class="d-empty"><p class="empty-t">What's on the air?</p>
    <p class="empty-d">Type a frequency above, in kHz (9580) or MHz with a dot (9.58, 146.73), to see who transmits there,
    their schedule and what's nearby. Or try one of these:</p>
    <div class="tags">${examples.map(([k, t]) => `<button class="tag" type="button" data-look="${k}">${t}</button>`).join("")}</div></div>`;
}

// The card's foot: tune, keep, filter by distance, and where the data comes from
export function actionsHtml() {
  const k = view.k, d = view.data;
  const tune = state.ok && k !== view.radioK
    ? `<button class="small primary" type="button" data-act="tunehere">Tune radio to ${fmtKHz(k)}</button>` : "";
  const band = bandFor(k), inList = band && mem.list.find((e) => e.band === band && e.kHz === k);
  const add = !band ? "" : inList ? `<button class="small" type="button" disabled>In memories · ${band} CH ${inList.ch}</button>`
    : `<button class="small" type="button" data-act="addmem">+ Memory</button>`;
  // On Radio: store what the radio is on, on the channel after the last one in use
  const here = following() ? `<button class="small" type="button" id="storehere" data-act="storehere"${canStoreHere() ? "" : " disabled"} ` +
    `title="Saves what the radio is tuned to on the channel after the last one in use">Store here</button>` : "";
  const has = d && (d.stations.length || d.shortwave.length);
  const near = has ? `<button class="small toggle" type="button" data-act="nearme" aria-pressed="${nearMe}">Near me</button>` : "";
  const radSel = has && located() && d.stations.length
    ? `<select class="radius" data-act="radius" aria-label="Distance">` +
      RADII.map((r) => `<option value="${r}"${r === radius ? " selected" : ""}>${r ? `≤ ${r} km` : "any km"}</option>`).join("") + `</select>` : "";
  const refilter = has && located() && view.showAll ? `<button class="small" type="button" data-act="refilter">Near only</button>` : "";
  const ver = view.idx ? ` v${esc(view.idx.version)} · EiBi ${esc(view.idx.shortwaveSeason)}` : "";
  return `<div class="d-actions">${tune}${add}${here}${near}${radSel}${refilter}` +
    `<p class="note">Data: <a href="${RADIOMAP_SITE}" target="_blank" rel="noopener">radiomap.cl</a>${ver} · times in UTC</p></div>`;
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
    return `<div class="d-empty"><p class="empty-t">Not aimed here</p><p class="empty-d">Nothing on ${fmtKHz(view.k)} is aimed at ` +
      `${esc(myRegion())}; ${hidden} broadcast${hidden === 1 ? "" : "s"} to elsewhere.</p><div class="intro-act">${showAllBtn()}</div></div>`;
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
  if (nearMe && myPos && e.site && e.site.lat != null) grid.push(`<div><dt>Distance</dt><dd>${Math.round(haversineKm(myPos, e.site)).toLocaleString()} km</dd></div>`);
  if (e.lastHeard) grid.push(`<div><dt>Last heard</dt><dd>${esc(e.lastHeard.slice(0, 2))}/20${esc(e.lastHeard.slice(2))}</dd></div>`);
  const wins = rows.flatMap((r) => r.today).map(([s, t]) => `<i class="win" style="left:${s / 14.4}%;width:${(t - s) / 14.4}%"></i>`).join("");
  const slots = rows.map((r) => {
    const cls = r.air.on ? "cur" : r === next ? "next" : r.today.length ? "" : "idle";
    const to = r.e.targetLabel || r.e.target;
    return `<tr class="${cls}"><td>${hhmm(r.e.startUTC)}–${hhmm(r.e.endUTC)}</td>` +
      `<td>${flagHtml(ituFlag(r.e.itu), r.e.country)}${esc(r.e.station)}` +
      `<small>${esc([r.e.langLabel || r.e.lang, daysText(r.e)].filter(Boolean).join(" · "))}${to ? ` → ${esc(to)}` : ""}</small></td></tr>`;
  }).join("");
  return `<div class="d-head"><span class="pill${head.air.on ? " on" : ""}">${head.air.on ? "On air" : "Off air"}</span><span class="d-sub">${esc(sub)}</span></div>
    <h3 class="d-name">${view.flag ? "" : flagHtml(ituFlag(e.itu), e.country)}${esc(e.station)}</h3>
    <p class="d-meta">${esc(meta)}</p>
    <dl class="d-grid">${grid.join("")}</dl>
    <div class="sched"><h4 class="h"><span>Today</span></h4>
      <div class="bar">${wins}<i class="now" style="left:${m / 14.4}%"></i></div>
      <div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
    <div class="slots"><h4 class="h"><span>Schedule${hidden ? ` · ${list.length} of ${all.length} aimed at ${esc(myRegion())}` : ""}</span>` +
      `<span>${hidden ? showAllBtn() : list.length}</span></h4>
      <div class="slots-box"><table><tbody>${slots}</tbody></table></div></div>`;
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
    tags.push(tag(`Input · listen on ${fmtKHz(Math.round(s.rxKHz))}`, "amber"));
  }
  if (!inGrid && s.category === "atc") tags.push(tag("ATC"));
  if (!inGrid && s.isDMR) tags.push(tag(`DMR ${dmrText(s)}`.trim(), "cool"));
  if (s.isEcholink) tags.push(tag("EchoLink", "amber"));
  const url = radiomapUrl(s.url);
  if (url) tags.push(`<a class="tag" href="${esc(url)}" target="_blank" rel="noopener">radiomap ↗</a>`);
  return tags.join("");
}

export function stationHero({s, km}) {
  const dd = (label, v) => v ? `<div><dt>${label}</dt><dd>${esc(v)}</dd></div>` : "";
  const grid = s.category === "amateur"
    ? [dd("Output", s.rxKHz && fmtKHz(Math.round(s.rxKHz))), dd("Input", isRepeater(s) && fmtKHz(Math.round(s.txKHz))),
       dd("Tone", s.tono), dd("Shift", isRepeater(s) && fmtShift(s.rxKHz, s.txKHz)), dd("Power", s.potencia && `${s.potencia} W`),
       dd("DMR", s.isDMR && (dmrText(s) || "yes"))]
    : [dd("Band", s.banda), dd("Region", s.region)];
  if (km != null) grid.push(dd("Distance", `${Math.round(km).toLocaleString()} km`));
  const tags = stationTags(s, true), place = placeOf(s);
  const cat = isRepeater(s) ? "Repeater" : CATEGORY[s.category] || "Station";
  view.flag = bgFlag(stationFlag(s));
  return `<div class="d-head"><span class="pill cat">${esc(cat)}</span><span class="d-sub">${esc(s.signal || "")}</span></div>
    <h3 class="d-name">${view.flag ? "" : flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile")}${esc(s.nombre || s.signal || "")}</h3>
    ${place.length || s.notes ? `<p class="d-meta">${esc([...place, s.notes].filter(Boolean).join(" · "))}</p>` : ""}
    <dl class="d-grid">${grid.join("")}</dl>
    ${tags ? `<div class="tags">${tags}</div>` : ""}`;
}

export function renderStations() {
  const box = $("stations"), d = view.data;
  const {shown: rows, hidden} = d && !view.err ? stationView() : {shown: [], hidden: 0};
  // Without shortwave the first station is the dossier's hero (which also says when everything is too far)
  const list = d && d.shortwave.length ? rows : rows.slice(1);
  const farLine = hidden && (d.shortwave.length || rows.length);
  box.hidden = !list.length && !farLine;
  if (box.hidden) { box.innerHTML = ""; return; }
  const shown = view.all ? list : list.slice(0, 6);
  const title = d.shortwave.length ? `Stations · ${list.length}` : `Also on ${fmtKHz(view.k)} · ${list.length}`;
  const right = filtering() && radius ? `within ${radius} km` : located() ? "nearest first" : "";
  box.innerHTML = `<h2 class="h"><span>${title}</span>${right ? `<span>${right}</span>` : ""}</h2>` +
    `<ul class="list">${shown.map(stationRow).join("")}</ul>` +
    (list.length > shown.length ? `<button class="more" type="button" data-act="more">Show all ${list.length}</button>` : "") +
    (farLine ? `<p class="far">${hidden} farther than ${radius} km ${showAllBtn("Show them")}</p>` : "");
}

export function stationRow({s, km}) {
  const tags = stationTags(s), place = placeOf(s);
  return `<li class="st"><div class="st-main"><b>${flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile")}${esc(s.signal || "")}</b>` +
    `<span>${esc(s.nombre || "")}</span>` + (km != null ? `<span class="km">${Math.round(km).toLocaleString()} km</span>` : "") + `</div>` +
    (place.length || s.notes ? `<div class="st-sub">${esc([...place, s.notes].filter(Boolean).join(" · "))}</div>` : "") +
    (tags ? `<div class="tags">${tags}</div>` : "") + `</li>`;
}

export function renderNearby() {
  const box = $("nearby");
  box.hidden = !view.near.length;
  if (!view.near.length) { box.innerHTML = ""; return; }
  const fol = following(), loc = located();
  // Near me: only neighbours with a station within the radius, or shortwave aimed at the listener
  const rows = loc ? view.near.filter((n) => !n.data || nearPasses(n.data)).slice(0, 6) : view.near;
  // Shortwave neighbours are filtered by where they're aimed, the rest by distance
  const head = !loc ? "Nearby" : `Nearby · ${bandFor(view.k) === "SW" ? `to ${myRegion()}` : radius ? `≤ ${radius} km` : "near me"}`;
  box.innerHTML = `<h2 class="h"><span>${head}</span><span>${fol ? "tap to tune the radio" : "tap to look up"}</span></h2>` +
    (rows.length ? `<ul class="list">${rows.map((n) => nearRow(n, fol, loc)).join("")}</ul>`
      : `<p class="of-msg">Nothing nearby within ${radius} km or aimed at ${esc(myRegion())}.</p>`);
}
export const nearPasses = (d) => stationView(d.stations, true).shown.length > 0 || d.shortwave.some((e) => aimedAt(e, myTargets));

// One line per nearby frequency: what's on air there now, else what's next, else its first (or nearest) station
export function nearRow(n, fol, loc = false) {
  const label = n.k >= 30000 ? (n.k / 1000).toFixed(3) : String(n.k);
  let name = "…", sub = "", flag = "", lamp = "none";
  const d = n.data;
  const sw = d ? swView(d.shortwave, loc).shown : [];
  if (d && sw.length) {
    const {on, head} = swPick(sw), e = head.e;
    name = e.station; flag = flagHtml(ituFlag(e.itu), e.country); lamp = head.air.on ? "on" : "";
    sub = [e.langLabel || e.lang,
      head.air.on ? `on air until ${minHHMM(hhmmMin(e.endUTC))}` : head.air.startsIn != null ? `next ${hhmm(e.startUTC)} UTC` : "",
      on.length > 1 ? `+${on.length - 1} on air` : sw.length > 1 ? `${sw.length} slots` : ""].filter(Boolean).join(" · ");
  } else if (d && d.stations.length) {
    const {s, km} = stationView(d.stations, loc).shown[0] || stationRows(d.stations)[0];
    name = s.nombre || s.signal; flag = flagHtml(stationFlag(s), s.category === "global" ? "Worldwide" : "Chile");
    sub = [s.signal, placeOf(s)[1] || placeOf(s)[0], km != null && `${Math.round(km).toLocaleString()} km`,
      d.stations.length > 1 && `+${d.stations.length - 1} more`].filter(Boolean).join(" · ");
  } else if (d) name = "—";
  return `<li><button class="near-row${d ? "" : " loading"}" type="button" data-go="${n.k}" aria-label="${fol ? "Tune to" : "Look up"} ${fmtKHz(n.k)}${d ? ": " + esc(name) : ""}">` +
    `<span class="nf">${label}</span><span class="nn"><b>${flag}${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>` +
    `<span class="dot ${lamp}"></span></button></li>`;
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
    const k = parseFreqInput($("q").value);
    if (k === null) { toast("Type a frequency: 9580 (kHz), or 9.58 / 146.73 (MHz)", 4000, true); return; }
    $("q").value = ""; $("q").blur();
    lookUp(k);
  });
  $("q-clear").addEventListener("click", () => { $("q").value = ""; $("q").focus(); });
  renderRecent();
  document.addEventListener("change", (e) => {
    if (!e.target.matches('select[data-act="radius"]')) return;
    radius = +e.target.value;
    store.set("rf919.radius", radius);
    renderView();
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-go], [data-look], [data-act]");
    if (!t) return;
    if (t.dataset.go) goTo(+t.dataset.go);
    else if (t.dataset.look) lookUp(+t.dataset.look);
    else if (t.dataset.act === "more") { view.all = true; renderStations(); }
    else if (t.dataset.act === "nearme") toggleNearMe();
    else if (t.dataset.act === "showall") { view.showAll = true; renderView(); }
    else if (t.dataset.act === "refilter") { view.showAll = false; renderView(); }
    else if (t.dataset.act === "tunehere") tuneHere();
    else if (t.dataset.act === "addmem") addMem([{band: bandFor(view.k), kHz: view.k, ch: null, name: dossierName()}]);
    else if (t.dataset.act === "storehere") storeHere();
    else if (t.dataset.act === "connect") startBle();
    else if (t.dataset.act === "demo") startDemo();
  });
  // A flag the CDN can't serve becomes the globe
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains("flag")) img.outerHTML = globeSvg(img.alt);
  }, true);
  window.addEventListener("hashchange", route);
  // Tabs switch at once (no wait for hashchange) and still add a history entry, so Back returns to the previous tab
  $("tabbar").addEventListener("click", (e) => {
    const a = e.target.closest("[data-tab]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (a.dataset.tab === current) { window.scrollTo({top: 0, behavior: "smooth"}); return; }  // tap again: back to the top
    try { history.pushState(null, "", `#${a.dataset.tab}`); } catch { /* sandboxed */ }
    go(a.dataset.tab);
  });
  // Keep the on-air state, the "now" marker and the current slot moving
  setInterval(() => { if (!document.hidden && view.data) renderView(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && view.data) renderView(); });
  tickClock();
  setInterval(tickClock, 15000);
}
