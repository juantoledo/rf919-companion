import {GRID_PATHS, HF_MAX, SpaceWeather, TIERS, bandGrid, bestRange, estimate, gridSummary, windowTiers} from "../propagation.js";
import {aimedAt, dur, fmtKHz, minHHMM, utcDay} from "../radiomap.js";
import {SW_METERS} from "../memories.js";
import {pad2} from "../protocol.js";
import {$, esc, openTool} from "./shell.js";
import {bandReminderSet, keepFocus, locate, myPos, myTargets, renderDiscover, renderView, showBand, store, toggleBandReminder, view} from "./radio.js";
import {renderPicks} from "./find.js";

// ---- Reception: the estimate of whether a station can be heard from here (propagation.js) ----
// The signal bars answer a different question from the on-air lamps: the lamp says it's transmitting, the bars say you
// may hear it. No bars at all when there's nothing to go on (no position, no transmitter site, no solar data, above HF)
let swx = null, shown = null;
export const wxNow = () => swx ? swx.current() : null;
export const solarKnown = () => !!wxNow();
export const canEstimate = () => !!(myPos && wxNow());
const wxFor = (t) => swx ? swx.at(t) : null;   // measured near the present, forecast later: every estimate reads it, so they all agree

// t: when (ms). The aim only counts when the listener is inside a region EiBi targets are known for
export function swEstimate(e, k, t = Date.now()) {
  const aimed = e.target && myTargets.size ? aimedAt(e, myTargets) : null;
  return estimate({kHz: k, rx: myPos, tx: e.site, t, now: t, wx: wxFor(t), aimed});
}
export const stationEstimate = (s, k, t = Date.now()) => k < HF_MAX ? estimate({kHz: k, rx: myPos, tx: s, t, now: t, wx: wxFor(t)}) : null;
// For a row {e, air} of the schedule: now if it's on, at its start if that's within a day; further ahead the sun's state says little
export function airEstimate({e, air}, k, now = Date.now()) {
  if (air.on) return swEstimate(e, k, now);
  return air.startsIn != null && air.startsIn <= 1440 ? swEstimate(e, k, now + air.startsIn * 60000) : null;
}

export const barsHtml = (tier) => `<span class="prop-bars b${TIERS[tier].bars} t-${tier}" aria-hidden="true"><i></i><i></i><i></i></span>`;
// For a list row: the bars, with what a screen reader gets in the row's label
export const rowBars = (est) => est ? barsHtml(est.tier) : "";
export const rowSay = (est) => est ? `, reception ${TIERS[est.tier].label.toLowerCase()}` : "";

// The dossier's badge; when: the UTC time it's about, if not now. Tapping it says why
export function propBadge(est, k, when = "") {
  if (!est) return "";
  shown = {est, k};
  const {label} = TIERS[est.tier], km = `${Math.round(est.km).toLocaleString("en-US")} km`, at = when ? ` · at ${when} UTC` : "";
  return `<div class="d-prop"><button class="small prop t-${est.tier}" type="button" data-act="prop" data-keep="prop" aria-haspopup="dialog" ` +
    `aria-label="Reception estimate: ${label}, ${km}${at}. Why?">${barsHtml(est.tier)}<b>${label}</b><span>${km}${at}</span></button></div>`;
}
export function openProp() {
  if (!shown) return;
  const {est, k} = shown, {label, meaning} = TIERS[est.tier], wx = wxNow();
  $("prop-body").innerHTML = `<p class="prop-verdict t-${est.tier}">${barsHtml(est.tier)}<b>${label}</b></p><p>${meaning}</p>` +
    `<ul class="prop-why">${est.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` +
    `<p class="note">${wx ? `${wxText(wx)} · ` : ""}solar data from NOAA SWPC. An estimate from a simple model, which doesn't know the transmitter's power, your antenna or the local noise.</p>`;
  openTool("prop-pane", `Reception · ${fmtKHz(k)}`, "medium");
}
const age = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : `${dur(m)} ago`; };
const wxText = (wx) => [`SFI ${wx.sfi}`, wx.kpKnown && `Kp ${wx.kp}`, wx.fetched && `updated ${age(wx.fetched)}`].filter(Boolean).join(" · ");

// The Today bar's windows for a schedule row, each with its tier ("" when there's no estimate)
export function tintedWindows({e, today}, k, now = Date.now()) {
  if (!canEstimate()) return today.map(([s, t]) => ({s, t, tier: ""}));
  const day = utcDay(now);
  return today.flatMap(([s, t]) => windowTiers(s, t, (m) => { const est = swEstimate(e, k, day + m * 60000); return est ? est.tier : ""; }));
}
// What the tinted bar shows, in words, for a screen reader; "" when it isn't tinted
export function windowsSay(wins) {
  const parts = wins.filter((w) => w.tier).sort((a, b) => a.s - b.s).map((w) => `${TIERS[w.tier].label} ${minHHMM(w.s)} to ${minHHMM(w.t % 1440 || 1440).replace(/^00:00$/, "24:00")}`);
  return parts.length ? `Reception estimate for today, UTC: ${parts.join(", ")}` : "";
}
export const TIER_KEY = `<p class="prop-key" aria-hidden="true">${Object.entries(TIERS).map(([t, {label}]) => `<span><i class="p-${t}"></i>${label}</span>`).join("")}</p>`;

// ---- the conditions line, on Explore's home ----
export function renderConditions() {
  const box = $("conds"), wx = wxNow();
  if (!box) return;
  box.hidden = !wx;
  if (!wx) { keepFocus(box, ""); return; }
  const storm = [wx.kp >= 5 && "Geomagnetic storm", wx.r >= 1 && `Radio blackout R${wx.r}`].filter(Boolean).join(" · ");
  const best = myPos ? (({lo, hi}) => `Best now: ${lo}–${hi} MHz`)(bestRange(myPos, wx, Date.now())) : "";
  const old = wx.fetched && Date.now() - wx.fetched > 3 * 3600000 ? `updated ${age(wx.fetched)}` : "";
  const facts = [`<span title="Solar flux">SFI ${wx.sfi}</span>`, wx.kpKnown && `<span title="Geomagnetic activity">Kp ${wx.kp}</span>`, best && `<b>${best}</b>`, storm && `<em>${storm}</em>`, old].filter(Boolean).join(" · ");
  keepFocus(box, `<button class="conds-btn" type="button" data-act="conds" aria-haspopup="dialog" aria-label="Conditions, band by band. ${esc(plain(facts))}">${facts}</button>`);
}

// ---- the Conditions sheet: which meter bands should be open, hour by hour, for the next day ----
// One drawing surface rather than 336 buttons (a cell is ~14 px wide): tap or drag a cell, or use the arrow keys, and the
// readout under it says what that cell means. Bands run high to low like a dial, times from the present rightwards
const HOUR = 3600000, COLS = 24;
const plain = (html) => html.replace(/<[^>]+>/g, "");
let cond = null;    // {path, utc, grid, name (the band picked), x (its column)}
const condOpen = () => $("tools").open && !$("conds-pane").hidden;
const hourText = (t) => { const d = new Date(t); return `${pad2(cond.utc ? d.getUTCHours() : d.getHours())}:00`; };
const colTime = (x) => cond.grid.start + x * HOUR;
const whenText = (x) => x ? `${hourText(colTime(x))}${cond.utc ? " UTC" : ""}` : "Now";
const listBands = (b) => b.length > 3 ? `${b[0]} to ${b.at(-1)}` : b.join(", ");

function paintGrid() {
  const {grid} = cond, rows = [...grid.rows].reverse();
  $("pg").innerHTML = rows.map((r, y) => `<span class="pg-b" data-row="${r.name}">${r.name}</span>` +
    r.cells.map((c, x) => `<i class="p-${c ? c.tier : "none"}" data-x="${x}" data-y="${y}"></i>`).join("")).join("") +
    `<span class="pg-b">Sun</span>` + grid.sun.map((c) => `<i class="pg-sun ${c > 0 ? "day" : c > -.2 ? "dusk" : "night"}"></i>`).join("") +
    `<span></span>` + [0, 6, 12, 18].map((x) => `<span class="pg-t" style="grid-column: span 6">${x ? hourText(colTime(x)) : "Now"}</span>`).join("");
}
function paintPick() {
  const {grid, name, x} = cond, y = [...grid.rows].reverse().findIndex((r) => r.name === name), row = grid.rows.find((r) => r.name === name), c = row.cells[x];
  $("pg").querySelector("i.sel")?.classList.remove("sel");
  $("pg").querySelector(`i[data-x="${x}"][data-y="${y}"]`).classList.add("sel");
  $("pg").querySelectorAll(".pg-b[data-row]").forEach((b) => b.classList.toggle("on", b.dataset.row === name));
  if (!c) { keepFocus($("pg-read"), `<p class="pg-why">No estimate for ${name} at this hour.</p>`); return; }
  const at = colTime(x), set = bandReminderSet(name, at), remind = x > 0 && c.tier !== "unlikely", labels = c.open.map((id) => GRID_PATHS.find((p) => p.id === id).label);
  const why = cond.path !== "all" ? `${GRID_PATHS.find((p) => p.id === c.path).label}. ${c.reasons[0]}` : labels.length ? `Could reach you from ${labels.length} of ${GRID_PATHS.length} regions: ${labels.join(", ")}` : "No region looks open at this hour";
  keepFocus($("pg-read"), `<p class="prop-verdict t-${c.tier}">${barsHtml(c.tier)}<b>${name} · ${whenText(x)} · ${TIERS[c.tier].label}</b></p>` +
    `<p class="pg-why">${esc(why)}</p><div class="pg-acts"><button class="small filled" type="button" data-act="cond-band">Who's on ${name} now</button>` +
    (remind ? `<button class="small toggle" type="button" data-act="cond-remind" aria-pressed="${set}" title="A reminder, while this page is open">${set ? "Reminder set" : `Remind ${whenText(x)}`}</button>` : "") + `</div>`);
}
function paintHead(wx) {
  const now = Date.now(), facts = [`SFI ${wx.sfi}`, wx.kpKnown && `Kp ${wx.kp}`, `R${wx.r}`, wx.fetched && `updated ${age(wx.fetched)}`].filter(Boolean).join(" · ");
  const alerts = [wx.kp >= 5 && `Geomagnetic storm now (Kp ${wx.kp})`, wx.r >= 1 && `Radio blackout now (R${wx.r})`].filter(Boolean);
  let summary = "";
  if (cond.grid) {
    const s = gridSummary(cond.grid);
    summary = `<p class="c-summary">${s.now.length ? `Open now: ${listBands(s.now)}` : "Nothing looks open right now"}${s.next ? ` · ${s.next.band} around ${hourText(colTime(s.next.col))}` : ""}</p>`;
    const peak = Math.max(0, ...cond.grid.times.slice(1).map((t) => swx.at(t, now)).filter((w) => w.kpKnown).map((w) => w.kp));
    if (peak >= 5 && wx.kp < 5) alerts.push(`Storm forecast: Kp ${peak} in the next 24 hours`);
  }
  const risk = swx.risk(now);
  const odds = risk && (risk.minor >= 30 || risk.major >= 10) ? `<p class="c-facts">Blackout odds today: ${risk.minor}% minor, ${risk.major}% strong</p>` : "";
  $("conds-head").innerHTML = summary + `<p class="c-facts">${facts}</p>` + odds + alerts.map((a) => `<p class="c-alert">${a}</p>`).join("");
}
function renderSheet() {
  const wx = wxNow();
  $("conds-main").hidden = !(wx && myPos);
  if (!wx) { cond.grid = null; $("conds-head").innerHTML = `<p class="hint">No solar data yet. It comes from NOAA once the page has been online.</p>`; return; }
  if (!myPos) {
    cond.grid = null;
    paintHead(wx);
    $("conds-head").insertAdjacentHTML("beforeend", `<p class="hint">The grid is worked out for where you are. Your location stays in the browser.</p><button class="filled" type="button" data-act="cond-locate">Use my location</button>`);
    return;
  }
  const now = Date.now(), bands = SW_METERS.filter(([, lo, hi]) => !view.idx || view.idx.freqs.some((k) => k >= lo && k <= hi));
  const paths = cond.path === "all" ? GRID_PATHS : GRID_PATHS.filter((p) => p.id === cond.path);
  cond.grid = bandGrid({rx: myPos, bands, paths, now, hours: COLS, wxAt: (t) => swx.at(t, now)});
  // Keeps the pick when it can; else the band scoring best right now
  if (!cond.grid.rows.some((r) => r.name === cond.name)) cond.name = [...cond.grid.rows].sort((a, b) => (b.cells[0]?.score ?? -1e9) - (a.cells[0]?.score ?? -1e9))[0].name;
  paintHead(wx);
  paintGrid();
  paintPick();
}
function paintChoices() {
  $("conds-paths").innerHTML = `<legend>Transmitters in</legend>` + [{id: "all", label: "Worldwide"}, ...GRID_PATHS].map((p) =>
    `<label><input type="radio" name="condpath" value="${p.id}"${p.id === cond.path ? " checked" : ""}><span>${p.label}</span></label>`).join("");
  $("conds-key").innerHTML = Object.entries(TIERS).map(([t, {label}]) => `<span><i class="p-${t}"></i>${label}</span>`).join("");
  document.querySelectorAll('input[name="condtz"]').forEach((i) => { i.checked = i.value === (cond.utc ? "utc" : "local"); });
}
export function openConditions() {
  cond.x = 0; cond.name = null;
  paintChoices();
  renderSheet();
  openTool("conds-pane", "Conditions", "large");
}
function pick(el) {
  if (!el || el.dataset.x === undefined) return;
  const x = +el.dataset.x, name = [...cond.grid.rows].reverse()[+el.dataset.y].name;
  if (x === cond.x && name === cond.name) return;
  Object.assign(cond, {x, name});
  paintPick();
  if (navigator.vibrate) navigator.vibrate(5);
}
function wireSheet() {
  const pg = $("pg");
  let id = null;
  pg.addEventListener("pointerdown", (e) => { if (e.button > 0) return; id = e.pointerId; pg.setPointerCapture(id); pick(e.target.closest("i")); });
  pg.addEventListener("pointermove", (e) => { if (e.pointerId === id) pick(document.elementFromPoint(e.clientX, e.clientY)?.closest("#pg i")); });
  for (const end of ["pointerup", "pointercancel"]) pg.addEventListener(end, () => { id = null; });
  pg.addEventListener("keydown", (e) => {
    const names = [...cond.grid.rows].reverse().map((r) => r.name), y = names.indexOf(cond.name);
    const move = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Home: [-COLS, 0], End: [COLS, 0]}[e.key];
    if (!move) return;
    e.preventDefault();
    cond.x = Math.max(0, Math.min(COLS - 1, cond.x + move[0]));
    cond.name = names[Math.max(0, Math.min(names.length - 1, y + move[1]))];
    paintPick();
  });
  $("conds-pane").addEventListener("change", (e) => {
    if (e.target.name === "condpath") { cond.path = e.target.value; store.set("rf919.condpath", cond.path); renderSheet(); }
    else if (e.target.name === "condtz") { cond.utc = e.target.value === "utc"; store.set("rf919.condutc", cond.utc); renderSheet(); }
  });
  $("conds-pane").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "cond-locate") askPosition();
    else if (b.dataset.act === "cond-band") showBand(cond.name);
    else if (b.dataset.act === "cond-remind") {
      toggleBandReminder(cond.name, Math.round(cond.grid.rows.find((r) => r.name === cond.name).kHz), colTime(cond.x), whenText(cond.x));
      paintPick();
      $("pg-read").querySelector('[data-act="cond-remind"]')?.focus({preventScroll: true});   // it was redrawn under the finger
    }
  });
  $("conds").addEventListener("click", (e) => { if (e.target.closest('[data-act="conds"]')) openConditions(); });
}

const repaint = () => {
  renderConditions();
  if (cond && condOpen()) renderSheet();
  if (view.data) renderView();
  renderPicks();
  renderDiscover();
};
export const askPosition = () => locate().then(repaint, () => {});

function tick() {
  renderConditions();
  if (condOpen() && cond.grid && Math.floor(Date.now() / HOUR) * HOUR !== cond.grid.start) renderSheet();   // the grid starts at the present
  if (swx.due() && navigator.onLine) swx.refresh().catch(() => { /* the estimates just wait for the next try */ });
}
export function init() {
  cond = {path: store.get("rf919.condpath", "all"), utc: store.get("rf919.condutc", false), grid: null, name: null, x: 0};
  wireSheet();
  swx = new SpaceWeather({load: () => store.get("rf919.spacewx", null), save: (s) => store.set("rf919.spacewx", s), onChange: repaint});
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
