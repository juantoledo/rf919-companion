import {BANDS, BAND_CODES, frame} from "./protocol.js";
import {fmtKHz, haversineKm, parseFreqInput, toKHz} from "./radiomap.js";

// ---- Memories (see memory.md) ----
// There is no command to write a memory: each one is stored by replaying the front-panel keys
// (tune → MEMO long → channel digits → confirm), one channel at a time.
export const MAX_CH = 200;  // per band. ✓ live: 200 accepted, 201 refused
export const MEM_BANDS = ["FM", "AM", "SW", "AIR", "CB", "UHF", "VHF", "LW"];  // WB has 7 fixed WX channels, no memories
// Not confirmed on the radio yet (memory.md §8). Settle them with "Test one memory", then change them here
// ✓ live (fw 1.910): MEMO long → 10 state 2 (channel blinking, n = a proposed channel); each digit → 10 state 2
// n = the number typed so far; MEMO short → 01 (the frequency) and 10 state 0 (store mode closed).
// "pause" skips the wait at that step and waits pauseMs instead
export const MEMO_CFG = {
  confirmKey: "MEMO",     // MEMO short (24); fallback "FREQ" (0D, EN)
  memoWait: "preset",     // after MEMO long: the channel number must start blinking (10 state 2)
  channelWait: "preset",  // after the digits: the blinking number must be the channel typed, before confirming
  confirmWait: "preset",  // after confirm: store mode must close (10 state 0)
  stepMs: 150,            // between key presses
  pauseMs: 800,           // a fixed pause, where nothing is awaited
  timeoutMs: 4000,        // how long to wait for a reply
  echoMs: 1500,           // keypad entry: how long to wait for the radio's echo of one key (✓ live: ~400 ms each)
  // Start fresh. By hand, holding SCAN/ATS deletes every memory of the band (user report; over Bluetooth untested)
  wipeKey: "PLAY_LONG",   // 33: what the vendor app sends for a long press on its SCAN button
  wipeReply: null,        // a test (ev) => bool for the radio's reply once "Test band wipe" shows it; null = wait wipePauseMs
  wipePauseMs: 2000,      // also the window in which a scan that starts by mistake gets stopped
  stopKey: "PLAY",        // SCAN short: stops a scan
  verifyWipe: true,       // recall a channel afterwards; it must be empty
};
// kHz per band, checked in order. Inferred from the RF919 spec, not measured. CB lies inside SW: never picked automatically
export const BAND_RANGES = [["LW", 150, 519], ["AM", 520, 1710], ["SW", 1711, 29999], ["FM", 64000, 108000],
  ["AIR", 108001, 137000], ["VHF", 30000, 299999], ["UHF", 300000, 999999], ["CB", 26965, 27405]];
export const bandFor = (k) => (BAND_RANGES.find(([, lo, hi]) => k >= lo && k <= hi) || [null])[0];
export const bandRange = (band) => BAND_RANGES.find(([b]) => b === band) || null;
export const bandUnit = (band) => band === "AM" || band === "LW" ? "kHz" : "MHz";
// How a list line writes the frequency: kHz below 30 MHz, else MHz with 3 decimals (so 150.000 never reads as 150 kHz)
export const freqText = (k) => k >= 30000 ? (k / 1000).toFixed(3) : String(k);
export const memKey = (band, ch) => `${band}:${ch}`;
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// One memory per line: [channel] [band] frequency [name…]. A line starting with "#" is a comment
// (only whole lines, so a name may contain "#").
// No channel = the next free one in its band; no band = the band the frequency falls in
// defaultBand: the band of lines that don't name one (the band being edited); else the frequency's band
export function parseMemList(text, defaultBand = null) {
  const entries = [], errors = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1, t = raw.replace(/^\s*#.*/, "").trim().split(/\s+/).filter(Boolean);
    if (!t.length) return;
    const err = (msg) => errors.push({line, msg});
    let p = 0, ch = null, band = null;
    const isBand = (s) => s && (MEM_BANDS.includes(s.toUpperCase()) || s.toUpperCase() === "WB");
    if (/^\d{1,4}$/.test(t[0]) && t.length > 1 && (isBand(t[1]) || parseFreqInput(t[1]) !== null)) { ch = +t[0]; p = 1; }
    if (isBand(t[p])) { band = t[p++].toUpperCase(); }
    if (band === "WB") return err("WB has fixed weather channels, no memories");
    if (p >= t.length) return err("no frequency");
    let ftext = t[p++];
    if (/^(k|khz|m|mhz)$/i.test(t[p] || "")) ftext += t[p++];
    const k = parseFreqInput(ftext);
    if (k === null) return err(`"${ftext}" isn't a frequency`);
    if (ch !== null && !(ch >= 1 && ch <= MAX_CH)) return err(`channel ${ch} is outside 1–${MAX_CH}`);
    const named = !!band;
    band = band || defaultBand || bandFor(k);
    if (!band) return err(`no band covers ${fmtKHz(k)}`);
    entries.push({line, ch, band, named, kHz: k, name: t.slice(p).join(" ")});
  });
  return {entries, errors};
}

// Adds items to a list, at most MAX_CH per band. Items with a channel go first, so the free ones are known.
// Returns the new list (by band, then channel) and the items refused
export function addToList(list, items) {
  const used = {}, out = [...list], errors = [];
  for (const e of list) (used[e.band] ??= new Set()).add(e.ch);
  const ordered = [...items.filter((e) => e.ch != null), ...items.filter((e) => e.ch == null)];
  for (const it of ordered) {
    const u = used[it.band] ??= new Set();
    const err = (msg) => errors.push({line: it.line, msg: `${it.band} ${fmtKHz(it.kHz)}: ${msg}`});
    if (!MEM_BANDS.includes(it.band)) { err("this band has no memories"); continue; }
    let ch = it.ch;
    if (ch == null) {
      ch = 1;
      while (u.has(ch)) ch++;
      if (ch > MAX_CH) { err(`${it.band} is full (${MAX_CH}/${MAX_CH})`); continue; }
    } else if (!(Number.isInteger(ch) && ch >= 1 && ch <= MAX_CH)) { err(`channel ${ch} is outside 1–${MAX_CH}`); continue; }
    else if (u.has(ch)) { err(`${it.band} CH ${ch} is already in the list`); continue; }
    u.add(ch);
    out.push({band: it.band, kHz: it.kHz, ch, name: it.name || ""});
  }
  out.sort((a, b) => MEM_BANDS.indexOf(a.band) - MEM_BANDS.indexOf(b.band) || a.ch - b.ch);
  return {list: out, errors};
}
export const listToText = (list) => list.map((e) => `${e.ch} ${e.band} ${freqText(e.kHz)}${e.name ? " " + e.name : ""}`).join("\n");
export const bandCount = (list, band) => list.filter((e) => e.band === band).length;
export const bandSummary = (rows) => MEM_BANDS.filter((b) => bandCount(rows, b)).map((b) => `${b} ${bandCount(rows, b)}`).join(", ");

// ---- backup: the app's record ({"AIR:12": {kHz, name}}) as Edit as text lines ----
export function recordItems(record) {
  const rows = [];
  for (const [key, r] of Object.entries(record || {})) {
    const m = /^([A-Z]+):(\d{1,3})$/.exec(key), ch = m && +m[2];
    if (!m || !MEM_BANDS.includes(m[1]) || !(ch >= 1 && ch <= MAX_CH) || !r || !(r.kHz > 0)) continue;
    rows.push({band: m[1], ch, kHz: r.kHz, name: r.name || ""});
  }
  return addToList([], rows).list;  // sorted by band and channel, at most MAX_CH per band
}
// when: the time to put in the header, e.g. "2026-11-02 21:40"
export function backupText(record, when) {
  const rows = recordItems(record);
  return [`# RF919 memories · exported ${when} · ${rows.length} channel${rows.length === 1 ? "" : "s"}: ${bandSummary(rows) || "none"}`,
    "# one per line: channel band frequency name (kHz below 30 MHz, else MHz)", listToText(rows), ""].join("\n");
}

// Runs fn over items, n at a time; a failed item gives null. Stops starting new ones once signal aborts
export async function pool(items, n, fn, onProgress = () => {}, signal = null) {
  const out = new Array(items.length).fill(null);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length && !(signal && signal.aborted)) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch { out[i] = null; }
      onProgress(++done, items.length);
    }
  };
  await Promise.all(Array.from({length: Math.min(n, items.length)}, worker));
  return out;
}

// ---- waiting for the radio's replies ----
export class StepErr extends Error {}
export class CancelErr extends Error {}

// Every decoded event passes through feed(); expect() resolves on the first one that matches
export class Waiters {
  constructor() { this.set = new Set(); this.freq = null; this.preset = null; }
  feed(ev) {
    if ((ev.kind === "freq") && !ev.data.alert) this.freq = ev.data;
    if (ev.kind === "preset") this.preset = ev.data;
    for (const w of [...this.set]) if (w.pred(ev)) { this.set.delete(w); clearTimeout(w.timer); w.resolve(ev); }
  }
  // Register before sending what triggers the reply, then await it
  expect(pred, ms, what) {
    const w = {pred};
    const p = new Promise((resolve, reject) => {
      w.resolve = resolve; w.reject = reject;
      w.timer = setTimeout(() => { this.set.delete(w); reject(new StepErr(`no reply ${what}`)); }, ms);
    });
    p.catch(() => {});  // awaited later, or dropped when the send fails
    this.set.add(w);
    return p;
  }
  cancelAll(reason = "stopped") {
    for (const w of this.set) { clearTimeout(w.timer); w.reject(new CancelErr(reason)); }
    this.set.clear();
  }
}

// Types a frequency on the keypad (FREQ, digits and point, FREQ), one key at a time: each key waits for the
// radio's entry echo (0F) before the next. ✓ live: the radio takes ~400 ms per key and drops keys sent faster
// ("433.275" sent 150 ms apart arrived as 43.275, an input error). Resolves with the radio's new frequency;
// exact: it must be the one typed (storing), else any (manual tuning, where the radio may round to its step)
export async function typeEntry(link, w, text, cfg = MEMO_CFG, exact = true) {
  const keys = [...String(text).trim()].filter((c) => /[0-9.]/.test(c)).map((c) => c === "." ? "POINT" : c);
  if (!keys.length) throw new StepErr(`"${text}" isn't a frequency`);
  const shown = (k) => k === "POINT" ? "." : k;
  const refused = (ev) => ev.kind === "entry" && ev.data.result === 2;
  for (const k of ["FREQ", ...keys]) {
    const echo = w.expect((ev) => ev.kind === "entry", cfg.echoMs, `to key ${shown(k)} (the radio may have dropped it)`);
    await link.press(k);
    if (refused(await echo)) throw new StepErr(`the radio refused the entry at key ${shown(k)}`);
  }
  const want = parseFloat(text), unit = w.freq ? w.freq.unit : null;
  const k = unit === "kHz" ? Math.round(want) : Math.round(want * 1000);
  const done = w.expect((ev) => refused(ev) || (ev.kind === "freq" && (!exact || toKHz(ev.data) === k)), cfg.timeoutMs, `after typing ${text}`);
  await link.press("FREQ");
  let ev;
  try { ev = await done; } catch (e) {
    if (e instanceof StepErr && w.freq) throw new StepErr(`${e.message}; the radio is on ${fmtKHz(toKHz(w.freq))}`);
    throw e;
  }
  if (refused(ev)) throw new StepErr(`the radio refused ${text} (input error)`);
  return ev.data;
}

// Stores and reads back memories through a link (BleLink, VirtualLink or ReplayLink). note(text) marks each step in the log
export class MemoryRun {
  constructor(link, waiters, {note = () => {}, cfg = MEMO_CFG} = {}) {
    Object.assign(this, {link, w: waiters, note, cfg, stopped: false, reason: ""});
  }
  stop(reason = "stopped") { this.stopped = true; this.reason = reason; this.w.cancelAll(reason); }
  check() { if (this.stopped) throw new CancelErr(this.reason); }
  async press(key) { this.check(); await this.link.press(key); await delay(this.cfg.stepMs); }
  // One digit per echo, like typeEntry: sent faster, the radio drops a repeated digit (✓ live: CH 11 arrived as 1).
  // echo(prefix) tests the reply to the digits so far; strict: no echo is an error, else carry on after echoMs
  async digits(ch, echo = (ev) => ev.kind === "preset", strict = false) {
    const s = String(ch);
    for (let i = 0; i < s.length; i++) {
      const want = +s.slice(0, i + 1);
      const got = this.w.expect((ev) => echo(ev, want), this.cfg.echoMs, "");
      await this.press(s[i]);
      try { await got; } catch (e) {
        if (e instanceof CancelErr) throw e;
        if (strict && !echo({kind: "preset", data: this.w.preset || {}}, want)) {
          const p = this.w.preset;  // it may not repeat a number that's already up, hence the check of the last one
          throw new StepErr(p && p.state === 2 ? `the radio shows CH ${p.n}, not ${want}${want === ch ? "" : ` (on the way to ${ch})`}; not confirmed`
            : `the radio isn't showing CH ${want}; not confirmed`);
        }
      }
    }
  }

  async toBand(band) {
    if (this.w.freq && this.w.freq.band === band) return;
    const got = this.w.expect((ev) => ev.kind === "freq" && ev.data.band === band, this.cfg.timeoutMs, `switching to ${band}`);
    this.check();
    await this.link.tune(band, 0);
    await got;
  }

  // Band switch with 10, then the frequency on the keypad, in the unit the band shows (the 10 units are only known for SW)
  async tuneTo(band, k) {
    await this.toBand(band);
    if (toKHz(this.w.freq) === k) return;
    const unit = this.w.freq.unit, text = unit === "MHz" ? String(k / 1000) : String(k);
    this.check();
    await typeEntry(this.link, this.w, text, this.cfg);
  }

  async store({band, kHz, ch}, onStep = () => {}) {
    if (!(Number.isInteger(ch) && ch >= 1 && ch <= MAX_CH)) throw new StepErr(`channel ${ch} is outside 1–${MAX_CH}`);
    if (!MEM_BANDS.includes(band)) throw new StepErr(`${band} has no memories`);
    const c = this.cfg, tag = `${band} ${fmtKHz(kHz)} → CH ${ch}`;
    onStep("tune"); this.note(`── store ${tag}: tune`);
    await this.tuneTo(band, kHz);
    const blinking = (ev) => ev.kind === "preset" && ev.data.state === 2;
    onStep("memo"); this.note(`── store ${tag}: MEMO long`);
    const memo = c.memoWait === "preset" ? this.w.expect(blinking, c.timeoutMs, "after MEMO long (store mode didn't open)") : null;
    await this.press("MEMO_LONG");
    if (memo) await memo; else await delay(c.pauseMs);
    onStep("channel"); this.note(`── store ${tag}: channel digits`);
    // Each digit must show up in the blinking number (1, then 11) before the next; never confirm another channel
    if (c.channelWait === "preset") await this.digits(ch, (ev, want) => blinking(ev) && ev.data.n === want, true);
    else { await this.digits(ch, () => false); await delay(c.pauseMs); }
    onStep("confirm"); this.note(`── store ${tag}: confirm (${c.confirmKey})`);
    const done = c.confirmWait === "preset"
      ? this.w.expect((ev) => ev.kind === "preset" && ev.data.state === 0, c.timeoutMs, "after confirm (store mode didn't close)") : null;
    await this.press(c.confirmKey);
    if (done) await done; else await delay(c.pauseMs);
  }

  // Stores what the radio is on, on the channel the radio proposes: ✓ live, the highest channel in use + 1
  // (38 in use, 40 stored by hand → it proposed 41). guard(n) returns a reason to refuse, and then nothing
  // is confirmed (the radio closes store mode by itself after ~5 s). Resolves with the channel used
  async storeNext(band, guard = () => null, onStep = () => {}) {
    if (!MEM_BANDS.includes(band)) throw new StepErr(`${band} has no memories`);
    const c = this.cfg, blinking = (ev) => ev.kind === "preset" && ev.data.state === 2;
    onStep("memo"); this.note(`── store next ${band}: MEMO long`);
    const prop = this.w.expect(blinking, c.timeoutMs, "after MEMO long (store mode didn't open)");
    await this.press("MEMO_LONG");
    const n = (await prop).data.n;
    this.note(`── store next ${band}: the radio proposes CH ${n}`);
    const no = !(n >= 1 && n <= MAX_CH) ? `the radio proposes CH ${n}: ${band} has no channel after the last one in use (max ${MAX_CH})` : guard(n);
    if (no) throw new StepErr(no);
    onStep("confirm"); this.note(`── store next ${band}: confirm CH ${n} (${c.confirmKey})`);
    const done = this.w.expect((ev) => ev.kind === "preset" && ev.data.state === 0, c.timeoutMs, "after confirm (store mode didn't close)");
    await this.press(c.confirmKey);
    await done;
    return n;
  }

  // PRESET → digits → FREQ (EN). {kHz, empty}: the frequency the radio reports, or empty = it said NULL.
  // Both unset = no reply
  async recall(band, ch) {
    if (!(Number.isInteger(ch) && ch >= 1 && ch <= MAX_CH)) throw new StepErr(`channel ${ch} is outside 1–${MAX_CH}`);
    this.note(`── recall ${band} CH ${ch}`);
    await this.toBand(band);
    await this.press("PRESET");
    await this.digits(ch);
    const isNull = (ev) => /\bNULL\b/.test((ev.data && (ev.data.text ?? ev.data.value)) || "");
    const got = this.w.expect((ev) => ev.kind === "freq" || (["toast", "field", "status_text"].includes(ev.kind) && isNull(ev)),
      this.cfg.timeoutMs, `recalling ${band} CH ${ch}`);
    await this.press("FREQ");
    let ev = null;
    try { ev = await got; } catch (e) { if (e instanceof CancelErr) throw e; this.note(`(no reply recalling CH ${ch})`); }
    await this.press("PRESET");  // leave recall mode
    return {kHz: ev && ev.kind === "freq" ? toKHz(ev.data) : null, empty: !!ev && ev.kind !== "freq"};
  }

  // Deletes every memory of a band (SCAN/ATS held), stops a scan if one starts, then recalls channel
  // probeCh, which must now be empty. Pick a channel known to have held something
  async wipe(band, probeCh = 1, onStep = () => {}) {
    const c = this.cfg;
    onStep("band"); this.note(`── wipe ${band}: switch band`);
    await this.toBand(band);
    onStep("wipe"); this.note(`── wipe ${band}: ${c.wipeKey}`);
    const seen = new Set();
    const scanning = this.w.expect((ev) => ev.kind === "freq" && seen.add(toKHz(ev.data)).size >= 2, c.wipePauseMs, "");
    const reply = c.wipeReply ? this.w.expect(c.wipeReply, c.timeoutMs, `after ${c.wipeKey} (the band wasn't wiped)`) : null;
    await this.press(c.wipeKey);
    if (reply) await reply;
    let scan = false;
    try { await scanning; scan = true; } catch (e) { if (e instanceof CancelErr) throw e; }  // timeout = no scan
    if (scan) {
      this.note(`(the radio started a scan; pressing ${c.stopKey} to stop it)`);
      await this.press(c.stopKey);
      await delay(c.pauseMs);
    }
    if (!c.verifyWipe) return;
    onStep("verify");
    const r = await this.recall(band, probeCh);
    if (r.empty) return;
    throw new StepErr(r.kHz != null ? `CH ${probeCh} still holds ${fmtKHz(r.kHz)}: the band wasn't wiped`
      : `no reply recalling CH ${probeCh}, so the wipe can't be confirmed (set verifyWipe: false if NULL never arrives)`);
  }
}

// Fixed steps for "Test one memory": no waiting, so every reply can be read in the log. Keys within a step
// go TEST_KEY_MS apart, slower than the radio handles them (~400 ms), so none get dropped
export const TEST_KEY_MS = 600;
export function storeTestSteps({band, kHz, ch}, confirmKey) {
  return [
    {label: `switch to ${band}`, run: (link) => link.tune(band, 0)},
    {label: `type ${fmtKHz(kHz)}`, run: (link, w) => {
      const unit = w.freq && w.freq.band === band ? w.freq.unit : bandUnit(band);
      return link.typeFreq(unit === "MHz" ? String(kHz / 1000) : String(kHz));
    }},
    {label: "MEMO long", run: (link) => link.press("MEMO_LONG")},
    {label: `channel ${ch}`, run: async (link) => { for (const d of String(ch)) { await link.press(d); await delay(TEST_KEY_MS); } }},
    {label: `confirm (${confirmKey})`, run: (link) => link.press(confirmKey)},
  ];
}
// Holds SCAN, listens, then recalls CH 1 so the log shows what an empty channel looks like
export function wipeTestSteps(band) {
  return [
    {label: `switch to ${band}`, run: (link) => link.tune(band, 0)},
    {label: `hold SCAN (${MEMO_CFG.wipeKey})`, run: (link) => link.press(MEMO_CFG.wipeKey)},
    {label: "listen 5 s", run: () => delay(5000)},
    {label: "PRESET", run: (link) => link.press("PRESET")},
    {label: "channel 1", run: (link) => link.press("1")},
    {label: "FREQ (EN)", run: (link) => link.press("FREQ")},
    {label: "PRESET (leave recall)", run: (link) => link.press("PRESET")},
  ];
}
export function recallTestSteps(band, ch) {
  return [
    {label: `switch to ${band}`, run: (link) => link.tune(band, 0)},
    {label: "PRESET", run: (link) => link.press("PRESET")},
    {label: `channel ${ch}`, run: async (link) => { for (const d of String(ch)) { await link.press(d); await delay(TEST_KEY_MS); } }},
    {label: "FREQ (EN)", run: (link) => link.press("FREQ")},
  ];
}

// EiBi broadcast meter bands, kHz
export const SW_METERS = [["120m", 2300, 2495], ["90m", 3200, 3400], ["75m", 3900, 4000], ["60m", 4750, 5060], ["49m", 5900, 6200],
  ["41m", 7200, 7600], ["31m", 9400, 9900], ["25m", 11600, 12100], ["22m", 13570, 13870], ["19m", 15100, 15800],
  ["16m", 17480, 17900], ["15m", 18900, 19020], ["13m", 21450, 21850], ["11m", 25670, 26100]];

// What Explore's band strip spans around k: its SW meter band, the gap between two of them, or the band. null off the bands
export function stripRange(k) {
  const band = bandFor(k);
  if (!band) return null;
  if (band !== "SW") { const [, lo, hi] = bandRange(band); return {label: band, lo, hi}; }
  const m = SW_METERS.find(([, lo, hi]) => k >= lo && k <= hi);
  if (m) return {label: m[0], lo: m[1], hi: m[2]};
  const below = SW_METERS.filter(([, , hi]) => hi < k).pop(), above = SW_METERS.find(([, lo]) => lo > k);
  return {label: "SW", lo: below ? below[2] + 1 : bandRange("SW")[1], hi: above ? above[1] - 1 : bandRange("SW")[2]};
}
// Explore's way in: a chip per band (SW per meter band) with data, each with its count and first kHz
export function bandChips(freqs) {
  const groups = [["AM", (k) => bandFor(k) === "AM"],
    ...SW_METERS.map(([m, lo, hi]) => [m, (k) => k >= lo && k <= hi]),
    ...["FM", "AIR", "VHF", "UHF"].map((b) => [b, (k) => bandFor(k) === b])];
  return groups.map(([label, has]) => { const ks = freqs.filter(has); return {label, n: ks.length, k: ks[0]}; }).filter((c) => c.n);
}
// Stations across many frequencies (pairs: [[kHz, lookup]]), one per kHz to listen on: the nearest there.
// A repeater is listed on its input too; it's heard on its output. Nearest first, then by kHz
export function nearestStations(pairs, {band, kind = "all", pos = null, radius = 0}) {
  const best = new Map();
  for (const [at, d] of pairs) {
    for (const s of (d && d.stations) || []) {
      if (kind !== "all" && s.category !== kind) continue;
      const k = s.category === "amateur" && s.rxKHz ? Math.round(s.rxKHz) : at;
      if (bandFor(k) !== band) continue;
      const km = pos && s.lat != null && s.lon != null ? haversineKm(pos, s) : null;
      if (radius && (km == null || km > radius)) continue;
      const cur = best.get(k);
      if (!cur || (km ?? Infinity) < (cur.km ?? Infinity)) best.set(k, {k, s, km});
    }
  }
  return [...best.values()].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.k - b.k);
}

// The pretend radio behind the tests' replay, and the base of No radio's VirtualRadio (virtual.js): answers tune (10) and key (0C) frames the way the store sequence expects,
// with 8 banks of MAX_CH channels. emit(frame) gets the radio's replies as raw frames
export class RadioSim {
  constructor(emit) {
    Object.assign(this, {emit, active: false, band: "SW", kHz: 11620, last: {}, mode: null, buf: "", bank: new Map(),
      storeTimer: 0, storeTimeoutMs: 5000});  // ✓ live: store mode left open closes after ~5 s
  }
  sendFreq() {
    const raw = this.kHz, mhz = bandUnit(this.band) === "MHz";
    const dp = mhz ? 0x10 | Math.max(1, String(raw).length - 3) : 0;  // digits from slot 1, 3 decimals
    this.emit(frame(0x01, [BAND_CODES[this.band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24, mhz ? 0 : 1, dp, 0]));
  }
  preset(state, n) { this.emit(frame(0x10, [state, n])); }
  toast(text) { const b = [...text].map((c) => c.charCodeAt(0)); this.emit(frame(0x23, [3, b.length, ...b])); }
  receive(pkt) {
    const cmd = pkt[2], d = pkt.slice(3, -1);
    this.active = true;
    if (cmd === 0x10) {
      const band = BANDS[d[0]], raw = (d[1] | d[2] << 8 | d[3] << 16 | d[4] << 24) >>> 0;
      if (!band || !bandRange(band)) return;
      this.last[this.band] = this.kHz;
      this.band = band;
      this.kHz = raw ? (band === "SW" ? Math.round(raw / 100) : raw) : this.last[band] || bandRange(band)[1];
      this.mode = null;
      this.sendFreq();
      return;
    }
    if (cmd !== 0x0C) return;
    const key = d[0], digit = key >= 1 && key <= 9 ? String(key) : key === 0x0A ? "0" : null;
    if (digit !== null) {
      if (this.mode) this.buf += digit;
      if (this.mode === "store") { this.shown = +this.buf; this.preset(2, this.shown & 255); }  // the blinking number follows the digits
      if (this.mode === "entry") this.echo(1);
      return;
    }
    switch (key) {
      case 0x0C: if (this.mode === "entry") { this.buf += "."; this.echo(1); } return;
      case 0x0B: this.buf = this.buf.slice(0, -1); return;
      case 0x0D:  // FREQ / EN
        if (this.mode === "entry") return this.enter();
        if (this.mode === "store") return this.save();
        if (this.mode === "recall") return this.recall();
        this.mode = "entry"; this.buf = "";
        this.echo(1);
        return;
      case 0x2C:                                                                 // MEMO long
        this.mode = "store"; this.buf = ""; this.shown = this.proposal(); this.preset(2, this.shown);
        clearTimeout(this.storeTimer);
        this.storeTimer = setTimeout(() => { if (this.mode === "store") { this.mode = null; this.preset(0, 0); } }, this.storeTimeoutMs);
        return;
      case 0x24:                                                                 // MEMO short
        if (this.mode === "store") this.save();
        else if (this.mode === "recall") { this.mode = null; this.preset(0, 0); }   // leave channel mode
        else { this.mode = "recall"; this.buf = ""; this.preset(1, this.proposal() - 1 || MAX_CH); }
        return;
      case 0x33:                                                                 // SCAN long: wipe the band
        for (const k of [...this.bank.keys()]) if (k.startsWith(this.band + ":")) this.bank.delete(k);
        return;
    }
  }
  // 0F: result (0 done, 1 typing, 2 input error) and the digits so far, the point lit where typed
  echo(result) {
    const [int, dec] = this.buf.split("."), raw = +(this.buf.replace(".", "") || 0);
    const dp = dec !== undefined && int ? 0x10 | int.length : 0;
    this.emit(frame(0x0F, [result, BAND_CODES[this.band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24, bandUnit(this.band) === "MHz" ? 0 : 1, dp]));
  }
  enter() {
    const v = parseFloat(this.buf), k = Math.round(bandUnit(this.band) === "MHz" ? v * 1000 : v), r = bandRange(this.band);
    this.mode = null;
    if (!(v > 0) || (r && (k < r[1] || k > r[2]))) { this.echo(2); this.buf = ""; this.echo(0); this.sendFreq(); return; }
    this.buf = "";
    this.echo(0);
    this.kHz = k;
    this.sendFreq();
  }
  // ✓ live: MEMO long proposes the highest channel in use + 1 (1 when the band is empty). Past 200: unknown
  proposal() {
    const used = [...this.bank.keys()].filter((k) => k.startsWith(this.band + ":")).map((k) => +k.split(":")[1]);
    return used.length ? Math.max(...used) + 1 : 1;
  }
  // Saves on the number shown: the one typed, or the proposal when nothing was typed (Store here)
  save() {
    const ch = this.shown;
    if (!(ch >= 1 && ch <= MAX_CH)) { this.toast("ERR"); return; }  // stays in store mode
    this.mode = null;
    this.bank.set(memKey(this.band, ch), this.kHz);
    this.sendFreq();
    this.preset(0, 0);
  }
  // Stays in recall (preset) mode afterwards, as the radio does, until PRESET is pressed again
  recall() {
    const ch = +this.buf, k = this.bank.get(memKey(this.band, ch));
    this.buf = "";
    if (k == null) { this.toast("NULL"); return; }
    this.kHz = k;
    this.sendFreq();
    this.preset(1, ch);
  }
}
