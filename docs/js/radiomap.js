import {formatFreq, pad2} from "./protocol.js";

// ---- radiomap.cl lookup (contract: radiomap README, "API por frecuencia") ----
export const RADIOMAP = "https://www.radiomap.cl/api/v1/";
export const RADIOMAP_SITE = "https://www.radiomap.cl/";
export const EMPTY_FREQ = Object.freeze({stations: [], shortwave: []});
export const DAY = 86400000;

// The tuned frequency as radiomap keys it: integer kHz, halves up. null = nothing to look up
export function toKHz({raw, dp, unit, alert}) {
  if (!raw || alert) return null;
  const v = parseFloat(formatFreq(raw, dp)) * (unit === "MHz" ? 1000 : 1);
  return Number.isFinite(v) && v > 0 ? Math.floor(v + 0.5) : null;
}
export const fmtKHz = (k) => k >= 30000 ? `${(k / 1000).toFixed(3)} MHz` : `${k} kHz`;

// Closest kHz with data, within a window that suits the band's channel spacing; sorted ascending
// SW ±25 (5 kHz channels), MW ±20, FM broadcast ±400 (200 kHz channels), VHF ±100, UHF ±200
export const nearWindow = (k) => k < 1800 ? 20 : k < 30000 ? 25 : k >= 87500 && k <= 108000 ? 400 : k < 300000 ? 100 : 200;
export function nearby(freqs, k, n = 4, win = nearWindow(k)) {
  let lo = 0, hi = freqs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (freqs[mid] < k) lo = mid + 1; else hi = mid; }
  let a = lo - 1, b = freqs[lo] === k ? lo + 1 : lo;
  const out = [];
  while (out.length < n) {
    const da = a >= 0 ? k - freqs[a] : Infinity, db = b < freqs.length ? freqs[b] - k : Infinity;
    if (Math.min(da, db) > win) break;
    out.push(da <= db ? freqs[a--] : freqs[b++]);
  }
  return out.sort((x, y) => x - y);
}

// The n-th kHz with data above (dir 1) or below (dir -1) k, or the last one that way when fewer are left; null at the end
export function stepKnown(freqs, k, dir, n = 1) {
  let lo = 0, hi = freqs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (freqs[mid] < k) lo = mid + 1; else hi = mid; }
  const first = dir > 0 ? (freqs[lo] === k ? lo + 1 : lo) : lo - 1;
  if (first < 0 || first >= freqs.length) return null;
  return freqs[Math.max(0, Math.min(freqs.length - 1, first + (dir > 0 ? n - 1 : 1 - n)))];
}
// The kHz with data in [lo, hi], for the band strip
export const stripTicks = (freqs, lo, hi) => freqs.filter((k) => k >= lo && k <= hi);

// ---- EiBi schedule: is it on the air? ----
export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];  // API weekday 0 = Monday
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const SEASON = {4: "winter only", 5: "summer only"};
export const hhmmMin = (s) => +s.slice(0, 2) * 60 + +s.slice(2, 4);
export const minHHMM = (m) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(Math.floor(m) % 60)}`;
export const utcDay = (t) => Math.floor(t / DAY) * DAY;
export const apiWeekday = (d) => (d.getUTCDay() + 6) % 7;

// Start (00:00 UTC) of the last Sunday of a month
export function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getTime() - last.getUTCDay() * DAY;
}
// Boreal summer: last Sunday of March up to the last Sunday of October
export function borealSummer(t) {
  const y = new Date(t).getUTCFullYear();
  return t >= lastSunday(y, 2) && t < lastSunday(y, 9);
}

export function daysMatch(days, day) {
  const d = new Date(day), wd = apiWeekday(d), dom = d.getUTCDate();
  switch (days && days.t) {
    case "d": return true;
    case "w": return !!(days.m >> wd & 1);
    case "n": return wd === days.wd && Math.ceil(dom / 7) === days.n;
    case "l": return wd === days.wd && dom + 7 > new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    case "date": return dom === days.d && d.getUTCMonth() + 1 === days.m;
    default: return false;  // "irr": no fixed days
  }
}

// Does the entry start a broadcast on this UTC day (ms at 00:00)? Days count from the start time
export function runsOn(e, day) {
  if (e.season === 4 && borealSummer(day)) return false;
  if (e.season === 5 && !borealSummer(day)) return false;
  const iso = new Date(day).toISOString().slice(0, 10);
  if ((e.validFrom && iso < e.validFrom) || (e.validTo && iso > e.validTo)) return false;
  return daysMatch(e.days, day);
}

// [start, end] in minutes from its start day's midnight; end > 1440 when it crosses midnight
export function span(e) {
  const s = hhmmMin(e.startUTC);
  let end = hhmmMin(e.endUTC);
  if (end <= s) end += 1440;
  return [s, end];
}

// {on, endsIn} or {on: false, startsIn}, in minutes; startsIn is null when nothing within 5 weeks
export function swAir(e, now = Date.now()) {
  const [s, end] = span(e), today = utcDay(now), m = (now - today) / 60000;
  for (const back of [0, 1]) {
    const from = s - back * 1440, to = end - back * 1440;
    if (m >= from && m < to && runsOn(e, today - back * DAY)) return {on: true, endsIn: Math.ceil(to - m)};
  }
  for (let i = 0; i < 36; i++) {
    const at = i * 1440 + s;
    if (at > m && runsOn(e, today + i * DAY)) return {on: false, startsIn: Math.ceil(at - m)};
  }
  return {on: false, startsIn: null};
}

// The parts of today (UTC, minutes) during which the entry is on
export function todayWindows(e, now = Date.now()) {
  const [s, end] = span(e), today = utcDay(now), out = [];
  if (runsOn(e, today)) out.push([s, Math.min(end, 1440)]);
  if (end > 1440 && runsOn(e, today - DAY)) out.push([0, end - 1440]);
  return out;
}

export function daysText(e) {
  const days = e.days || {};
  let t;
  switch (days.t) {
    case "d": t = "daily"; break;
    case "w": t = days.m === 127 ? "daily" : days.m === 31 ? "Mon–Fri" : days.m === 96 ? "Sat–Sun" : WD.filter((_, i) => days.m >> i & 1).join(" "); break;
    case "n": t = `${["1st", "2nd", "3rd", "4th", "5th"][days.n - 1] || days.n + "th"} ${WD[days.wd]} of month`; break;
    case "l": t = `last ${WD[days.wd]} of month`; break;
    case "date": t = `${days.d} ${MON[days.m - 1]}`; break;
    default: t = "irregular";
  }
  return SEASON[e.season] ? `${t} · ${SEASON[e.season]}` : t;
}
// Shortwave across many frequencies (pairs: [[kHz, lookup]]): the entry on air on each, else the next to start
// within win minutes; only those aimed at targets when given. In the order of pairs
export function swOnAir(pairs, {now = Date.now(), win = 0, targets = null} = {}) {
  const out = [];
  for (const [k, d] of pairs) {
    if (!d || !d.shortwave || !d.shortwave.length) continue;
    const rows = d.shortwave.filter((e) => !targets || aimedAt(e, targets)).map((e) => ({e, air: swAir(e, now)}));
    const on = rows.find((r) => r.air.on);
    const soon = rows.filter((r) => !r.air.on && r.air.startsIn != null && r.air.startsIn <= win)
      .sort((a, b) => a.air.startsIn - b.air.startsIn)[0];
    const r = on || soon;
    if (r) out.push({k, e: r.e, air: r.air, data: d});
  }
  return out;
}
export const dur = (min) => min < 60 ? `${min} min` : min < 2880 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${Math.round(min / 1440)} days`;

// ---- stations ----
export function haversineKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Initial great-circle course from a to b, degrees clockwise from north (0–360)
export function bearingDeg(a, b) {
  const r = Math.PI / 180, p1 = a.lat * r, p2 = b.lat * r, dl = (b.lon - a.lon) * r;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
// "18,240 km · NW 312°"
export const kmBearing = (from, to, km = haversineKm(from, to)) => `${Math.round(km).toLocaleString()} km · ${compass(bearingDeg(from, to))} ${Math.round(bearingDeg(from, to)) % 360}°`;
// Repeater shift: input (tx) relative to output (rx)
export function fmtShift(rx, tx) {
  const d = Math.round(tx - rx);
  if (!d) return "simplex";
  const a = Math.abs(d);
  return `${d < 0 ? "−" : "+"}${a >= 1000 ? +(a / 1000).toFixed(3) + " MHz" : a + " kHz"}`;
}
export const radiomapUrl = (u) => typeof u === "string" && u.startsWith(RADIOMAP_SITE) ? u : null;

// ---- where a shortwave broadcast is aimed (EiBi target) ----
// Hand-made and approximate: rough [latMin, latMax, lonMin, lonMax] boxes per EiBi target code. Regions run from
// specific to general (the first match names the listener's region). Country targets only for the Americas
export const TARGET_AREAS = [
  ["SAm", "South America", [[-56, 13, -82, -34]]], ["CAm", "Central America", [[7, 19, -93, -77]]],
  ["Car", "the Caribbean", [[10, 27, -86, -59]]], ["ENA", "eastern North America", [[24, 60, -100, -50]]],
  ["WNA", "western North America", [[24, 72, -170, -100]]], ["LAm", "Latin America", [[-56, 32, -118, -34]]],
  ["NAm", "North America", [[15, 84, -170, -50]]], ["Am", "the Americas", [[-56, 84, -170, -30]]],
  ["WEu", "western Europe", [[36, 60, -10, 8]]], ["CEu", "central Europe", [[45, 55, 5, 25]]],
  ["NEu", "northern Europe", [[54, 71, -25, 32]]], ["EEu", "eastern Europe", [[44, 60, 22, 45]]],
  ["SEE", "south-eastern Europe", [[35, 48, 13, 30]]], ["SEu", "southern Europe", [[35, 47, -10, 30]]],
  ["Eu", "Europe", [[35, 71, -25, 45]]], ["Cau", "the Caucasus", [[38, 44, 37, 51]]], ["ME", "the Middle East", [[12, 42, 25, 63]]],
  ["NAf", "North Africa", [[15, 37, -18, 35]]], ["WAf", "West Africa", [[4, 25, -18, 16]]], ["CAf", "Central Africa", [[-14, 12, 8, 31]]],
  ["EAf", "East Africa", [[-12, 18, 28, 52]]], ["SAf", "southern Africa", [[-35, -8, 11, 41]]], ["Af", "Africa", [[-35, 37, -18, 52]]],
  ["CAs", "Central Asia", [[35, 56, 46, 88]]], ["SAs", "South Asia", [[5, 37, 60, 98]]], ["SEA", "South-East Asia", [[-11, 24, 92, 141]]],
  ["FE", "the Far East", [[18, 54, 100, 150]]], ["Sib", "Siberia", [[50, 78, 60, 180]]], ["As", "Asia", [[-11, 78, 26, 180]]],
  ["Oc", "Oceania", [[-48, 0, 110, 180], [-30, 20, -180, -130]]],
].map(([code, name, boxes]) => ({code, name, boxes, region: true})).concat([
  ["CHL", [[-28, -17.5, -71.5, -67], [-56, -28, -76, -69.8]]], ["ARG", [[-40, -21.8, -69.5, -53.6], [-55, -40, -71.8, -63]]],
  ["B", [[-34, 5.3, -74, -34.8]]], ["BOL", [[-23, -9.7, -69.6, -57.5]]], ["PRU", [[-18.4, 0, -81.4, -68.7]]],
  ["CLM", [[-4.2, 12.5, -79, -66.9]]], ["EQA", [[-5, 1.5, -81, -75.2]]], ["VEN", [[0.6, 12.2, -73.4, -59.8]]],
  ["PRG", [[-27.6, -19.3, -62.6, -54.3]]], ["URG", [[-35, -30.1, -58.4, -53.1]]], ["GUY", [[1.2, 8.6, -61.4, -56.5]]],
  ["SUR", [[1.8, 6, -58.1, -54]]], ["MEX", [[14.5, 32.7, -118.4, -86.7]]], ["USA", [[24.5, 49.4, -125, -66.9], [51, 71.5, -170, -130]]],
  ["CAN", [[41.7, 83, -141, -52.6]]], ["CUB", [[19.8, 23.3, -85, -74.1]]],
].map(([code, boxes]) => ({code, name: code, boxes, region: false})));
export const inBox = (p, [a, b, c, d]) => p.lat >= a && p.lat <= b && p.lon >= c && p.lon <= d;
// The EiBi target codes that cover a position
export const targetsAt = (pos) => new Set(pos ? TARGET_AREAS.filter((t) => t.boxes.some((x) => inBox(pos, x))).map((t) => t.code) : []);
export const aimedAt = (e, targets) => String((e && e.target) || "").split(/[,/]/).some((t) => targets.has(t.trim()));
export const targetsName = (targets) => (TARGET_AREAS.find((t) => t.region && targets.has(t.code)) || {name: "your region"}).name;

// ---- search ----
// "9580" / "720" kHz, "9.58" / "146.73" / "101.3" MHz, "101" MHz, "7" MHz, "720k", "9,58" (comma decimal), "146.73 MHz"
export function parseFreqInput(text) {
  const m = String(text).trim().toLowerCase().replace(",", ".").match(/^(\d+(?:\.\d*)?|\.\d+)\s*(k|khz|m|mhz)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!(v > 0)) return null;
  const mhz = m[2] ? m[2][0] === "m" : m[1].includes(".") ? v < 1000 : v < 150;
  const k = Math.floor(v * (mhz ? 1000 : 1) + 0.5);
  return k < 3e6 ? k : null;
}

// ---- flags ----
// EiBi (ITU) country code -> flag-icons key (ISO 3166-1 alpha-2, or its extras: sh-ac, sh-ta, ic, xk, un, um, tf).
// Hand-made from EiBi's README "II) Country codes"; codes with no country (CLA, IW, XUU…) get a globe
export const ITU_FLAG = new Map((
  "ABW:aw AFG:af AFS:za AGL:ao AIA:ai ALB:al ALG:dz ALS:us AMS:tf AND:ad AOE:eh ARG:ar ARM:am ARS:sa ASC:sh-ac " +
  "ATA:aq ATG:ag AUS:au AUT:at AZE:az AZR:pt B:br BAH:bs BDI:bi BEL:be BEN:bj BER:bm BES:bq BFA:bf BGD:bd BHR:bh " +
  "BIH:ba BIO:io BLM:bl BLR:by BLZ:bz BOL:bo BOT:bw BRB:bb BRM:mm BRU:bn BTN:bt BUL:bg BVT:bv CAB:ao CAF:cf " +
  "CAN:ca CBG:kh CEU:es CHL:cl CHN:cn CHR:cx CKH:ck CLM:co CLN:lk CME:cm CNR:ic COD:cd COG:cg COM:km CPT:fr " +
  "CPV:cv CRO:tf CTI:ci CTR:cr CUB:cu CUW:cw CVA:va CYM:ky CYP:cy CZE:cz D:de DJI:dj DMA:dm DNK:dk DOM:do E:es " +
  "EGY:eg EQA:ec ERI:er EST:ee ETH:et EUR:tf F:fr FIN:fi FJI:fj FLK:fk FRO:fo FSM:fm G:gb GAB:ga GEO:ge GHA:gh " +
  "GIB:gi GLP:gp GMB:gm GNB:gw GNE:gq GPG:ec GRC:gr GRD:gd GRL:gl GTM:gt GUF:gf GUI:gn GUM:gu GUY:gy HKG:hk " +
  "HMD:hm HND:hn HNG:hu HOL:nl HRV:hr HTI:ht HWA:us HWL:um I:it ICO:cc IND:in INS:id IRL:ie IRN:ir IRQ:iq ISL:is " +
  "ISR:il IWA:jp J:jp JAR:um JDN:tf JMC:jm JMY:sj JON:um JOR:jo JUF:cl KAL:ru KAZ:kz KEN:ke KER:tf KGZ:kg KIR:ki " +
  "KNA:kn KOR:kr KOS:xk KRE:kp KWT:kw LAO:la LBN:lb LBR:lr LBY:ly LCA:lc LIE:li LSO:ls LTU:lt LUX:lu LVA:lv " +
  "MAC:mo MAF:mf MAU:mu MCO:mc MDA:md MDG:mg MDR:pt MDW:um MEL:es MEX:mx MHL:mh MKD:mk MLA:my MLD:mv MLI:ml " +
  "MLT:mt MNE:me MNG:mn MOZ:mz MRA:mp MRC:ma MRN:za MRT:mq MSR:ms MTN:mr MWI:mw MYA:mm MYT:yt NCG:ni NCL:nc " +
  "NFK:nf NGR:ne NIG:ng NIU:nu NMB:na NOR:no NPL:np NRU:nr NZL:nz OCE:pf OMA:om PAK:pk PAQ:cl PHL:ph PHX:ki " +
  "PLM:um PLW:pw PNG:pg PNR:pa POL:pl POR:pt PRG:py PRU:pe PRV:jp PSE:ps PTC:pn PTR:pr QAT:qa REU:re ROD:mu " +
  "ROU:ro RRW:rw RUS:ru S:se SAP:co SDN:sd SEN:sn SEY:sc SGA:gs SHN:sh SLM:sb SLV:sv SMA:as SMO:ws SMR:sm SNG:sg " +
  "SOK:aq SOM:so SPM:pm SRB:rs SRL:sl SSD:ss SSI:gs STP:st SUI:ch SUR:sr SVB:sj SVK:sk SVN:si SWZ:sz SXM:sx " +
  "SYR:sy TCA:tc TCD:td TGO:tg THA:th TJK:tj TKL:tk TKM:tm TLS:tl TON:to TRC:sh-ta TRD:tt TUN:tn TUR:tr TUV:tv " +
  "TWN:tw TZA:tz UAE:ae UGA:ug UKR:ua UN:un URG:uy USA:us UZB:uz VCT:vc VEN:ve VIR:vi VRG:vg VTN:vn VUT:vu WAK:um " +
  "WAL:wf XGZ:ps XWB:ps YEM:ye ZMB:zm ZWE:zw "
).trim().split(" ").map((p) => p.split(":")));
export const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/";
export const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
export const ituFlag = (itu) => ITU_FLAG.get(itu) || null;
// radiomap's stations are Chilean, except the worldwide channels (category "global")
export const stationFlag = (s) => s.category === "global" ? null : "cl";
export const globeSvg = (title) => `<svg class="flag none" viewBox="0 0 16 12" role="img" aria-label="${escHtml(title)}"><title>${escHtml(title)}</title>` +
  `<circle cx="8" cy="6" r="4.6"/><ellipse cx="8" cy="6" rx="2" ry="4.6"/><path d="M3.4 6h9.2"/></svg>`;
export function flagHtml(key, title = "") {
  if (!key || !/^[a-z]{2}(-[a-z]{2})?$/.test(key)) return globeSvg(title || "International");
  return `<img class="flag" src="${FLAG_CDN}${key}.svg" alt="${escHtml(title)}" title="${escHtml(title)}" loading="lazy" decoding="async">`;
}

export class RadioMap {
  // onData(k, data): every frequency file read, by whichever path (the name index learns from them; null = 404)
  constructor(base = RADIOMAP) { this.base = base; this.cache = new Map(); this.idx = null; this.onData = null; }

  async get(path) {
    const r = await fetch(this.base + path);
    const m = this.onData && path.match(/^freq\/(\d+)\.json$/);
    if (r.status === 404) { if (m) this.onData(+m[1], null); return null; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (m) this.onData(+m[1], data);
    return data;
  }

  // index.json, fetched once
  index() {
    if (!this.idx) this.idx = this.get("index.json").catch((e) => { this.idx = null; throw e; });
    return this.idx;
  }

  // Everything on k kHz (404 = nothing known there). In-flight requests are shared, failures not cached
  lookup(k) {
    if (!this.cache.has(k)) {
      if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(k, this.get(`freq/${k}.json`)
        .then((d) => d || {...EMPTY_FREQ, kHz: k})
        .catch((e) => { this.cache.delete(k); throw e; }));
    }
    return this.cache.get(k);
  }
}
