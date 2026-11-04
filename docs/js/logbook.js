// ---- The listening log: what the radio stayed on, with its best signal ----
// No DOM. The page feeds it the radio's settled frequency (feed) and its signal readings (signal), and calls tick now
// and then; a frequency held for dwellMs becomes an entry, which keeps growing while the radio stays. Coming back to
// it within joinMs carries on the same entry, so a quick look elsewhere doesn't split a broadcast in two.
export const DWELL_MS = 30000, JOIN_MS = 10 * 60000, LOG_MAX = 2000, SIGNAL_MS = 60000;

// An entry: {id, k, band, mode, start, end (ms), rssi, snr (peaks, null when never read), station, flag, star, demo}
export class Logbook {
  constructor(entries = [], {dwellMs = DWELL_MS, joinMs = JOIN_MS, max = LOG_MAX, onChange = () => {}} = {}) {
    Object.assign(this, {entries, dwellMs, joinMs, max, onChange, here: null});
  }
  // k null: off the air for the log (not connected, busy, an alert)
  feed(k, band, t, {mode = "", demo = false} = {}) {
    if (this.here && this.here.k === k && this.here.demo === demo) { this.tick(t); return; }
    this.here = k == null ? null : {k, band, mode, demo, since: t, rssi: null, snr: null, entry: null};
    if (!this.here) return;
    const last = this.entries.findLast((e) => e.k === k && !!e.demo === demo);
    if (last && t - last.end <= this.joinMs) this.here.entry = last;
    this.tick(t);
  }
  signal({rssi = null, snr = null}, t) {
    const h = this.here;
    if (!h) return;
    const up = (a, b) => b == null || Number.isNaN(b) ? a : a == null ? b : Math.max(a, b);
    h.rssi = up(h.rssi, rssi); h.snr = up(h.snr, snr);
    if (h.entry) { h.entry.rssi = up(h.entry.rssi, rssi); h.entry.snr = up(h.entry.snr, snr); }
    this.tick(t);
  }
  tick(t) {
    const h = this.here;
    if (!h) return;
    if (h.entry) {
      if (t > h.entry.end) { h.entry.end = t; this.onChange("update", h.entry); }
      return;
    }
    if (t - h.since < this.dwellMs) return;
    const e = h.entry = {id: `${h.since.toString(36)}-${h.k}`, k: h.k, band: h.band, mode: h.mode, start: h.since, end: t,
      rssi: h.rssi, snr: h.snr, station: "", flag: "", star: false, ...(h.demo ? {demo: true} : {})};
    this.entries.push(e);
    while (this.entries.length > this.max) this.entries.shift();
    this.onChange("open", e);
  }
  remove(id) {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const [e] = this.entries.splice(i, 1);
    if (this.here && this.here.entry === e) this.here.entry = null;
    return {e, i};
  }
  restore({e, i}) { this.entries.splice(Math.min(i, this.entries.length), 0, e); }
  dropDemo() {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => !e.demo);
    if (this.here && this.here.demo) this.here = null;
    return n - this.entries.length;
  }
  // What the log knows of k: how many entries, and the last one's end
  heard(k) {
    let n = 0, last = 0;
    for (const e of this.entries) if (e.k === k) { n++; last = Math.max(last, e.end); }
    return {n, last};
  }
}

// The last spanMs of signal readings, for the meter on Radio
export class Signal {
  constructor(spanMs = SIGNAL_MS) { this.span = spanMs; this.pts = []; }
  add(rssi, snr, t) {
    this.pts.push({t, rssi, snr});
    while (this.pts.length && this.pts[0].t < t - this.span) this.pts.shift();
  }
  reset() { this.pts = []; }
  best(key) { return this.pts.reduce((b, p) => p[key] == null ? b : b == null ? p[key] : Math.max(b, p[key]), null); }
  last(key) { for (let i = this.pts.length - 1; i >= 0; i--) if (this.pts[i][key] != null) return this.pts[i][key]; return null; }
}

// ---- export ----
const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const hm = (t) => { const d = new Date(t); return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`; };
const csvCell = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

export function toCsv(entries) {
  const head = ["date_utc", "start_utc", "end_utc", "khz", "band", "mode", "station", "rssi", "snr", "starred"];
  const rows = entries.map((e) => [ymd(e.start), hm(e.start), hm(e.end), e.k, e.band, e.mode, e.station, e.rssi, e.snr, e.star ? "yes" : ""]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ADIF is ASCII: accents dropped, anything else non-ASCII left out
const ascii = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").trim();
const field = (name, v) => { const s = ascii(v); return s ? `<${name}:${s.length}>${s} ` : ""; };
// ADIF's bands are the amateur ones; broadcast frequencies go without one
const ADIF_BANDS = [["160m", 1800, 2000], ["80m", 3500, 4000], ["60m", 5060, 5450], ["40m", 7000, 7300], ["30m", 10100, 10150],
  ["20m", 14000, 14350], ["17m", 18068, 18168], ["15m", 21000, 21450], ["12m", 24890, 24990], ["10m", 28000, 29700],
  ["6m", 50000, 54000], ["2m", 144000, 148000], ["1.25m", 222000, 225000], ["70cm", 420000, 450000]];
export const adifBand = (k) => (ADIF_BANDS.find(([, lo, hi]) => k >= lo && k <= hi) || [""])[0];
// The radio's demodulation as ADIF's mode (and submode for the sidebands)
export function adifMode(e) {
  const m = String(e.mode || "").toUpperCase();
  if (m === "USB" || m === "LSB") return ["SSB", m];
  if (m === "CW") return ["CW", ""];
  if (m.includes("FM")) return ["FM", ""];
  if (m) return ["AM", ""];
  return [e.band === "FM" || e.band === "VHF" || e.band === "UHF" || e.band === "WB" ? "FM" : "AM", ""];
}
export function toAdif(entries, {program = "RF919 Companion", version = "1"} = {}) {
  let out = `RF919 Companion listening log\n${field("ADIF_VER", "3.1.4")}${field("PROGRAMID", program)}${field("PROGRAMVERSION", version)}<EOH>\n`;
  for (const e of entries) {
    const [mode, sub] = adifMode(e);
    const comment = [e.rssi != null && `RSSI ${e.rssi}`, e.snr != null && `SNR ${e.snr}`].filter(Boolean).join(" ");
    out += field("CALL", e.station || `${e.k} kHz`) + field("QSO_DATE", ymd(e.start)) + field("TIME_ON", hm(e.start)) +
      field("TIME_OFF", hm(e.end)) + field("FREQ", (e.k / 1000).toFixed(3)) + field("BAND", adifBand(e.k)) +
      field("MODE", mode) + field("SUBMODE", sub) + field("SWL", "Y") + field("COMMENT", comment) + "<EOR>\n";
  }
  return out;
}
