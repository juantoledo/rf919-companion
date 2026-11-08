import {haversineKm} from "./radiomap.js";

// ---- Reception estimate: can this station reach the listener now? ----
// No DOM. A deliberately simple model (solar flux, sun angle along the path, hops, where the broadcast is aimed), far
// short of VOACAP: the data has no transmitter power and it knows neither the antenna nor the local noise. Its
// coefficients are rough, so the page always calls the result an estimate
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

// The F2 layer's critical frequency in MHz: rises with the sun's height and the solar flux, with a floor at night
const foF2 = (c, sfi) => Math.max(0.28 * Math.sqrt(sfi), 0.55 * Math.sqrt(sfi) * (0.45 + 0.55 * Math.sqrt(Math.max(0, c))));
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

export class SpaceWeather {
  // load() / save(state): the cached readings. onChange(): a value changed, not merely the time it was read
  constructor({base = SWPC, load = () => null, save = () => {}, onChange = () => {}} = {}) {
    Object.assign(this, {base, save, onChange, state: {}, tried: 0, busy: null});
    const s = load();
    if (s && typeof s === "object") {
      for (const key of Object.keys(RANGE)) if (s[key] && reading(key, s[key].v, s[key].at)) this.state[key] = {v: s[key].v, at: s[key].at};
      if (Number.isFinite(s.fetched)) this.state.fetched = s.fetched;
    }
  }

  // {sfi, kp, r, kpKnown, fetched}, without what's too old; null when no solar flux is left to go on
  current(now = Date.now()) {
    const fresh = (key) => { const x = this.state[key]; return x && now - x.at <= WX_TTL[key] ? x.v : null; };
    const sfi = fresh("sfi"), kp = fresh("kp");
    return sfi === null ? null : {sfi, kp: kp ?? QUIET_KP, kpKnown: kp !== null, r: fresh("r") ?? 0, fetched: this.state.fetched ?? null};
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
    if (!got) return;
    this.state.fetched = now;
    this.save(this.state);
    if (changed) this.onChange();
  }
}
