import {haversineKm} from "./radiomap.js";

// ---- Reception estimate: can this station reach the listener now? ----
// No DOM. A deliberately simple model (solar flux, sun angle along the path, hops, where the broadcast is aimed), far
// short of VOACAP: the data has no transmitter power and it knows neither the antenna nor the local noise. Its
// coefficients are rough, so the page always calls the result an estimate. FOF2_CURVE is fitted to measurements, and
// tests/fixtures/propagation-calibration.json checks it and the MUF against them
export const HF_MAX = 30000;   // kHz. Above it reception is line of sight and solar data doesn't drive it: no estimate
export const MW_MAX = 1800;    // kHz. Below it: ground wave by day, sky wave at night, and no MUF to speak of
export const TIERS = {
  likely: {label: "Likely", bars: 3, meaning: "A good path right now. It should be audible on the radio's own antenna."},
  possible: {label: "Possible", bars: 2, meaning: "Weak or fading. An external wire antenna helps."},
  unlikely: {label: "Unlikely", bars: 1, meaning: "The path is poor right now. It may still get through, but don't count on it."},
};

const RAD = Math.PI / 180, DAY = 86400000, HOUR = 3600000;
const HOP_KM = 3500, LOCAL_KM = 60;
const LIKELY = 70, POSSIBLE = 40;

const hasPos = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

// The point where the sun is overhead. Ignores the equation of time (at most ~4° of longitude)
export function subsolar(t) {
  const d = new Date(t), doy = (t - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY;
  return {lat: -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365.25), lon: (12 - (t % DAY) / HOUR) * 15};
}
// Cosine of the sun's zenith angle: 1 overhead, 0 on the horizon, negative at night
export function cosZenith(p, t) {
  const s = subsolar(t);
  return Math.sin(p.lat * RAD) * Math.sin(s.lat * RAD) + Math.cos(p.lat * RAD) * Math.cos(s.lat * RAD) * Math.cos((p.lon - s.lon) * RAD);
}
// The point a fraction f of the way along the great circle from a to b
export function pathPoint(a, b, f) {
  const d = haversineKm(a, b) / 6371;
  if (d < 1e-6) return {lat: a.lat, lon: a.lon};
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const [la1, lo1, la2, lo2] = [a.lat, a.lon, b.lat, b.lon].map((v) => v * RAD);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return {lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD};
}
// Latitude from the geomagnetic pole of a dipole field (about 80.7°N, 72.7°W)
export function geomagLat(p) {
  const sin = Math.sin(p.lat * RAD) * Math.sin(80.7 * RAD) + Math.cos(p.lat * RAD) * Math.cos(80.7 * RAD) * Math.cos((p.lon + 72.7) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, sin))) / RAD;
}

// foF2 / √SFI against the sun's height (cos zenith): the medians of a week of ionosonde readings (Nov 2026, 20 stations
// away from the auroral zones, SFI 97–128). Flat through the night, climbing through twilight, levelling off by mid-morning
const FOF2_CURVE = [[-.3, .36], [0, .58], [.3, .79], [.6, .87], [1, .89]];
// The F2 layer's critical frequency in MHz
export function foF2(c, sfi) {
  const i = FOF2_CURVE.findIndex(([x]) => c < x), root = Math.sqrt(sfi);
  if (i === 0) return FOF2_CURVE[0][1] * root;
  if (i < 0) return FOF2_CURVE.at(-1)[1] * root;
  const [x0, y0] = FOF2_CURVE[i - 1], [x1, y1] = FOF2_CURVE[i];
  return (y0 + (y1 - y0) * (c - x0) / (x1 - x0)) * root;
}
// The secant law for a layer 300 km up; the earth's curve caps it at about 3.2 on a long hop
const mFactor = (hopKm) => Math.min(3.2, Math.hypot(1, hopKm / 600));
const absorbK = (c, sfi) => c > 0 ? 677 * c ** .75 * (1 + .0037 * (sfi - 70)) : 0;
const absorbDb = (c, sfi, mhz) => absorbK(c, sfi) / (mhz + .8) ** 1.98;
const tierOf = (score) => score >= LIKELY ? "likely" : score >= POSSIBLE ? "possible" : "unlikely";
const distText = (km) => `${Math.round(km).toLocaleString("en-US")} km`;

function mediumWave({km, rx, tx, t}) {
  const points = [rx, pathPoint(rx, tx, .5), tx], dark = points.every((p) => cosZenith(p, t) < -.1);
  const reasons = [`${distText(km)} on medium wave`], result = (tier, score) => ({tier, score, muf: null, absorption: null, km, hops: 0, reasons});
  if (km <= 150) { reasons.push("Within ground-wave range, day and night"); return result("likely", 90); }
  if (dark) {
    reasons.push("The whole path is in darkness, so sky wave carries medium wave");
    return km <= 800 ? result("likely", 75) : km <= 3000 ? result("possible", 50) : result("unlikely", 15);
  }
  reasons.push("Daylight on the path limits medium wave to ground wave");
  return km <= 400 ? result("possible", 45) : result("unlikely", 10);
}

function skywave({kHz, km, rx, tx, t, now, wx, aimed}) {
  const mhz = kHz / 1000, hops = Math.max(1, Math.ceil(km / HOP_KM));
  const points = Array.from({length: hops}, (_, i) => pathPoint(rx, tx, (i + .5) / hops));
  const suns = points.map((p) => cosZenith(p, t)), sunlit = suns.filter((c) => c > 0).length;
  const muf = Math.min(...suns.map((c) => foF2(c, wx.sfi) * mFactor(km / hops)));
  const absorption = suns.reduce((sum, c) => sum + absorbDb(c, wx.sfi, mhz), 0), ratio = mhz / muf;
  let score = 100 - Math.max(0, absorption - 8) * 2.5 - (hops - 1) * 8;
  score -= ratio > .9 ? 35 : ratio > .8 ? 15 : 0;
  const reasons = [`MUF ≈ ${Math.round(muf)} MHz, this is ${+mhz.toFixed(2)} MHz` + (ratio > 1.05 ? " (above it, so it passes through)" : ratio > .9 ? " (close to the limit)" : ""),
    `${distText(km)} in ${hops} hop${hops === 1 ? "" : "s"}`,
    sunlit === hops ? "Path in daylight" : sunlit ? "Path part day, part night" : "Path in darkness"];
  if (absorption > 10) reasons.push(`Daylight absorbs this frequency (≈${Math.round(absorption)} dB)`);
  if (aimed === true) { score += 10; reasons.push("Aimed at your region"); }
  else if (aimed === false) { score -= 25; reasons.push("Aimed elsewhere, so weaker here"); }
  // What's happening on the sun now says little about other hours
  if (Math.abs(t - now) <= 3 * HOUR) {
    if (wx.kp >= 5 && points.some((p) => Math.abs(geomagLat(p)) >= 55)) { score -= (wx.kp - 4) * 15; reasons.push(`Geomagnetic storm (Kp ${wx.kp}) on a high-latitude path`); }
    if (wx.r >= 1 && sunlit) { score -= [0, 10, 25, 50, 70, 90][wx.r] * sunlit / hops; reasons.push(`Radio blackout (R${wx.r}) on the sunlit part of the path`); }
  }
  return {tier: ratio > 1.05 ? "unlikely" : tierOf(score), score, muf, absorption, km, hops, reasons};
}

// {tier, score, muf, absorption, km, hops, reasons}, or null when there's nothing to go on.
// rx, tx: {lat, lon}; t: when (ms); now: the present, for disturbances; wx: SpaceWeather.current();
// aimed: true/false, null when unknown
export function estimate({kHz, rx, tx, t, now = t, wx, aimed = null}) {
  if (!(kHz > 0) || kHz >= HF_MAX || !hasPos(rx) || !hasPos(tx) || !wx || !(wx.sfi > 0)) return null;
  const km = haversineKm(rx, tx);
  if (kHz < MW_MAX) return mediumWave({km, rx, tx, t});
  if (km <= LOCAL_KM) return {tier: "likely", score: 100, muf: null, absorption: 0, km, hops: 0, reasons: [`Only ${distText(km)} from the transmitter: ground wave`]};
  return skywave({kHz, km, rx, tx, t, now, wx, aimed});
}

// Which shortwave is open over the listener now, in whole MHz: {lo, hi}, for the conditions line
export function bestRange(pos, wx, t) {
  const c = cosZenith(pos, t), luf = c > 0 ? Math.sqrt(absorbK(c, wx.sfi) / 15) - .8 : 0;
  const lo = Math.max(3, Math.round(luf));
  return {lo, hi: Math.max(lo, Math.round(.9 * foF2(c, wx.sfi) * 3.2))};
}

// ---- the band-by-hour grid (Explore's Conditions sheet) ----
// One real transmitter site per part of the world: where a broadcast aimed at the listener could come from
export const GRID_PATHS = [
  {id: "nam", label: "N. America", lat: 27.46, lon: -80.93},
  {id: "sam", label: "S. America", lat: -23.5, lon: -46.6},
  {id: "eur", label: "Europe", lat: 52.65, lon: 12.91},
  {id: "afr", label: "Africa", lat: -18.75, lon: 47.5},
  {id: "asi", label: "Asia", lat: 35.83, lon: 126.83},
  {id: "oce", label: "Oceania", lat: -38.84, lon: 176.4},
];
const TIER_RANK = {likely: 2, possible: 1, unlikely: 0};
// bands: [[name, loKHz, hiKHz]…]; wxAt(t): the solar data for a moment. The first column is the present, the others the
// middle of their hour. A cell says what at least half of the paths reach, so that one nearby region can't colour the whole
// grid: {tier, score, muf, reasons (of the path at that half), path, open (the ids of the paths not unlikely)}, or null with no estimate.
export function bandGrid({rx, bands, paths = GRID_PATHS, now, hours = 24, wxAt}) {
  const start = Math.floor(now / HOUR) * HOUR, times = Array.from({length: hours}, (_, i) => i ? start + (i + .5) * HOUR : now);
  const wxs = times.map(wxAt);
  const rows = bands.map(([name, lo, hi]) => ({name, kHz: (lo + hi) / 2, cells: times.map((t, i) => {
    const ranked = paths.flatMap((p) => {
      const e = estimate({kHz: (lo + hi) / 2, rx, tx: p, t, now: t, wx: wxs[i], aimed: true});
      return e ? [{p, e}] : [];
    }).sort((a, b) => TIER_RANK[b.e.tier] - TIER_RANK[a.e.tier] || b.e.score - a.e.score);
    if (!ranked.length) return null;
    const {p, e} = ranked[Math.min(Math.ceil(paths.length / 2), ranked.length) - 1];
    return {tier: e.tier, score: e.score, muf: e.muf, reasons: e.reasons, path: p.id, open: ranked.filter((x) => x.e.tier !== "unlikely").map((x) => x.p.id)};
  })}));
  return {start, hours, times, sun: times.map((t) => cosZenith(rx, t)), rows};
}
const openIn = (row, i) => row.cells[i] && row.cells[i].tier === "likely";
// In words: what's open now, and what opens next. {now: [band…], next: {band, col} | null}, the bands low to high
export function gridSummary({rows, hours}) {
  const now = rows.filter((r) => openIn(r, 0)).map((r) => r.name);
  let next = null;
  for (const r of rows) {
    if (openIn(r, 0)) continue;
    for (let i = 1; i < hours; i++) if (openIn(r, i)) { if (!next || i < next.col) next = {band: r.name, col: i}; break; }
  }
  return {now, next};
}

// What to suggest listening to, best first. rows: {k, key (the station, for keeping one frequency each), est, left (minutes
// on the air still), aimed}. ranked: by the estimate, dropping what's unlikely; else there's no estimate to go on, so
// what's aimed here comes first, then what stays on longest
const MIN_LEFT = 10;
export function rankSuggestions(rows, {ranked, max = 8}) {
  const order = ranked ? (a, b) => b.est.score - a.est.score : (a, b) => !!b.aimed - !!a.aimed;
  const seen = new Set();
  return rows.filter((r) => r.left >= MIN_LEFT && (!ranked || (r.est && r.est.tier !== "unlikely")))
    .sort((a, b) => order(a, b) || b.left - a.left || a.k - b.k)
    .filter((r) => !seen.has(r.key) && seen.add(r.key))
    .slice(0, max);
}

// A broadcast's window [s, end) in minutes, cut at the hours and merged where tierAt(minute) stays the same
export function windowTiers(s, end, tierAt) {
  const out = [];
  for (let a = s; a < end;) {
    const b = Math.min(end, (Math.floor(a / 60) + 1) * 60), tier = tierAt((a + b) / 2), last = out.at(-1);
    if (last && last.tier === tier) last.t = b; else out.push({s: a, t: b, tier});
    a = b;
  }
  return out;
}

// ---- the sun's state, from NOAA's Space Weather Prediction Center (open to any origin) ----
export const SWPC = "https://services.swpc.noaa.gov/";
export const WX_REFRESH = 30 * 60000;
export const WX_TTL = {sfi: 72 * HOUR, kp: 9 * HOUR, r: HOUR};
const QUIET_KP = 2;
const RANGE = {sfi: [50, 500], kp: [0, 9], r: [0, 5]};

const num = (x) => typeof x === "number" ? x : typeof x === "string" && x.trim() ? +x : NaN;
const inRange = (key, v) => Number.isFinite(v) && v >= RANGE[key][0] && v <= RANGE[key][1];
// NOAA's time tags are UTC, written without the Z
const utc = (s) => typeof s === "string" ? Date.parse(`${s}Z`) : NaN;
const reading = (key, v, at) => inRange(key, v) && Number.isFinite(at) ? {v, at} : null;
function lastReading(key, rows, field) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const x = rows[i] && reading(key, num(rows[i][field]), utc(rows[i].time_tag));
    if (x) return x;
  }
  return null;
}
export const parseFlux = (json) => lastReading("sfi", json, "flux");
export const parseKp = (json) => lastReading("kp", json, "Kp");
export function parseScales(json) {
  const now = json && json["0"];
  return now && now.R ? reading("r", num(now.R.Scale), utc(`${now.DateStamp}T${now.TimeStamp}`)) : null;
}
const FEEDS = [["sfi", "products/summary/10cm-flux.json", parseFlux], ["kp", "products/noaa-planetary-k-index.json", parseKp], ["r", "products/noaa-scales.json", parseScales]];

// ---- what NOAA expects: 3-hourly Kp, the odds of a blackout, and a month of solar flux ----
// Each is [] when it can't be read, so a change of format costs the forecast and nothing else
export function parseKpForecast(json) {
  if (!Array.isArray(json)) return [];
  return json.filter((x) => x && x.observed !== "observed").map((x) => reading("kp", num(x.kp), utc(x.time_tag))).filter(Boolean);
}
// The days ahead in noaa-scales.json ("1" is today): {at (the day, ms), minor, major (% chance of R1–R2 and of R3 or worse)}
export function parseRisk(json) {
  if (!json || typeof json !== "object") return [];
  return ["1", "2", "3"].flatMap((d) => {
    const x = json[d], at = x ? utc(`${x.DateStamp}T00:00:00`) : NaN, minor = x && x.R ? num(x.R.MinorProb) : NaN, major = x && x.R ? num(x.R.MajorProb) : NaN;
    return Number.isFinite(at) && Number.isFinite(minor) && Number.isFinite(major) ? [{at, minor, major}] : [];
  });
}
// SWPC's 27-day table, in text: "2026 Nov 09     125          15          4"
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
export function parseOutlook(text) {
  if (typeof text !== "string") return [];
  return [...text.matchAll(/^(\d{4}) ([A-Z][a-z]{2}) (\d{2})\s+(\d+)\s+\d+\s+\d+\s*$/gm)].flatMap(([, y, m, d, flux]) => {
    const month = MONTHS.indexOf(m), sfi = +flux;
    return month >= 0 && inRange("sfi", sfi) ? [{at: Date.UTC(+y, month, +d), sfi}] : [];
  });
}
const FORECAST_REFRESH = 6 * HOUR, NEAR_NOW = 3 * HOUR;
const FORECASTS = [["kp", "products/noaa-planetary-k-index-forecast.json", parseKpForecast, "json"], ["risk", "products/noaa-scales.json", parseRisk, "json"], ["flux", "text/27-day-outlook.txt", parseOutlook, "text"]];

export class SpaceWeather {
  // load() / save(state): the cached readings. onChange(): a value changed, not merely the time it was read
  constructor({base = SWPC, load = () => null, save = () => {}, onChange = () => {}} = {}) {
    Object.assign(this, {base, save, onChange, state: {}, tried: 0, forecastTried: 0, busy: null});
    const s = load();
    if (s && typeof s === "object") {
      for (const key of Object.keys(RANGE)) if (s[key] && reading(key, s[key].v, s[key].at)) this.state[key] = {v: s[key].v, at: s[key].at};
      if (Number.isFinite(s.fetched)) this.state.fetched = s.fetched;
      if (s.forecast && typeof s.forecast === "object") this.state.forecast = Object.fromEntries(FORECASTS.map(([key]) => [key, Array.isArray(s.forecast[key]) ? s.forecast[key] : []]));
    }
  }

  // {sfi, kp, r, kpKnown, fetched}, without what's too old; null when no solar flux is left to go on
  current(now = Date.now()) {
    const fresh = (key) => { const x = this.state[key]; return x && now - x.at <= WX_TTL[key] ? x.v : null; };
    const sfi = fresh("sfi"), kp = fresh("kp");
    return sfi === null ? null : {sfi, kp: kp ?? QUIET_KP, kpKnown: kp !== null, r: fresh("r") ?? 0, fetched: this.state.fetched ?? null};
  }

  // The solar data for a moment, as estimate() takes it. Around the present, what's measured. Further ahead, the forecast
  // where there is one; blackouts only come as odds, so they aren't counted. Behind the present, a quiet sun
  at(t, now = Date.now()) {
    const wx = this.current(now);
    if (!wx || Math.abs(t - now) <= NEAR_NOW) return wx;
    const quiet = {...wx, kp: QUIET_KP, kpKnown: false, r: 0};
    if (t < now || !this.state.forecast) return quiet;
    const {kp = [], flux = []} = this.state.forecast, slot = kp.find((x) => t >= x.at && t < x.at + NEAR_NOW), day = flux.find((x) => t >= x.at && t < x.at + DAY);
    return {...quiet, ...(slot ? {kp: slot.v, kpKnown: true} : {}), ...(day ? {sfi: day.sfi} : {})};
  }
  // The odds of a radio blackout on the UTC day of now, or null when they aren't known
  risk(now = Date.now()) {
    return ((this.state.forecast || {}).risk || []).find((x) => now >= x.at && now < x.at + DAY) || null;
  }

  due(now = Date.now()) { return now - Math.max(this.tried, this.state.fetched || 0) >= WX_REFRESH; }

  // Reads the three feeds; one that fails or changes shape leaves its last reading in place
  refresh(now = Date.now()) {
    this.tried = now;
    return this.busy ||= this.load(now).finally(() => { this.busy = null; });
  }
  async load(now) {
    const results = await Promise.allSettled(FEEDS.map(async ([, path, parse]) => {
      const r = await fetch(this.base + path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parse(await r.json());
    }));
    let got = false, changed = false;
    FEEDS.forEach(([key], i) => {
      const x = results[i].status === "fulfilled" ? results[i].value : null, old = this.state[key];
      if (!x) return;
      got = true;
      if (old && x.at < old.at) return;
      if (!old || old.v !== x.v) changed = true;
      this.state[key] = x;
    });
    let foreseen = false;
    if (now - this.forecastTried >= FORECAST_REFRESH) {
      this.forecastTried = now;
      foreseen = await this.loadForecast();
    }
    if (got) this.state.fetched = now;
    if (got || foreseen) this.save(this.state);
    if (changed || foreseen) this.onChange();
  }
  // true when something changed. Whatever can't be read keeps its last value
  async loadForecast() {
    const results = await Promise.allSettled(FORECASTS.map(async ([, path, parse, type]) => {
      const r = await fetch(this.base + path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parse(await r[type]());
    }));
    const old = this.state.forecast || {}, next = {...old};
    FORECASTS.forEach(([key], i) => {
      const x = results[i].status === "fulfilled" ? results[i].value : [];
      next[key] = x.length ? x : old[key] || [];
    });
    if (JSON.stringify(next) === JSON.stringify(old) || !Object.values(next).some((x) => x.length)) return false;
    this.state.forecast = next;
    return true;
  }
}
