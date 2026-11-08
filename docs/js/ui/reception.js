import {HF_MAX, SpaceWeather, TIERS, bestRange, estimate, windowTiers} from "../propagation.js";
import {aimedAt, dur, fmtKHz, minHHMM, utcDay} from "../radiomap.js";
import {$, esc, openTool} from "./shell.js";
import {keepFocus, locate, myPos, myTargets, renderDiscover, renderView, store, view} from "./radio.js";
import {renderOnAir} from "./find.js";

// ---- Reception: the estimate of whether a station can be heard from here (propagation.js) ----
// The signal bars answer a different question from the on-air lamps: the lamp says it's transmitting, the bars say you
// may hear it. No bars at all when there's nothing to go on (no position, no transmitter site, no solar data, above HF)
let swx = null, shown = null;
const wxNow = () => swx ? swx.current() : null;
export const canEstimate = () => !!(myPos && wxNow());

// t: when (ms). The aim only counts when the listener is inside a region EiBi targets are known for
export function swEstimate(e, k, t = Date.now()) {
  const aimed = e.target && myTargets.size ? aimedAt(e, myTargets) : null;
  return estimate({kHz: k, rx: myPos, tx: e.site, t, now: Date.now(), wx: wxNow(), aimed});
}
export const stationEstimate = (s, k, t = Date.now()) => k < HF_MAX ? estimate({kHz: k, rx: myPos, tx: s, t, now: Date.now(), wx: wxNow()}) : null;
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
  keepFocus(box, `<p>${facts}</p>` + (myPos ? "" : `<button class="small" type="button" data-act="prop-locate">Show reception estimates</button>`));
}
const repaint = () => {
  renderConditions();
  if (view.data) renderView();
  renderOnAir();
  renderDiscover();
};
export const askPosition = () => locate().then(repaint, () => {});

function tick() {
  renderConditions();
  if (swx.due() && navigator.onLine) swx.refresh().catch(() => { /* the estimates just wait for the next try */ });
}
export function init() {
  swx = new SpaceWeather({load: () => store.get("rf919.spacewx", null), save: (s) => store.set("rf919.spacewx", s), onChange: repaint});
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
