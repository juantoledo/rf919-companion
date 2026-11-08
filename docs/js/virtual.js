import {BANDS, BAND_CODES, DEMOD, frame} from "./protocol.js";
import {MAX_CH, RadioSim, bandRange, memKey} from "./memories.js";

// ---- No radio: a virtual RF919 ----
// The page talks to it through VirtualLink (link.js) exactly as it talks to the real radio over Bluetooth: it gets
// the same frames (PROTOCOL.md) back, so every view, the Remote, Memories and the Log work unchanged.
// It grows the demo's RadioSim (tune, keypad entry, memory store/recall/wipe) into a whole radio: stepping, seeking,
// scanning, bands, volume, squelch, demodulation, power, and a signal reading every 2 s.
// hooks: seek(band, kHz, dir) → the next kHz with a station (null = none known); signal(kHz) → 0..1, how strong
// that frequency comes in; save() → called when something worth keeping changed

// The bands it has, in the order BAND goes through them (WB has fixed weather channels: no range to tune)
export const VR_BANDS = ["FM", "AM", "SW", "LW", "AIR", "VHF", "UHF", "CB"];
// kHz per step, per band: the first is the default, STEP goes through the rest
export const BAND_STEPS = {FM: [100, 50, 10], AM: [9, 10, 1], SW: [5, 1], LW: [9, 1], AIR: [25, 5], VHF: [25, 5], UHF: [25, 5], CB: [10]};
// Each band's demodulations (DEMOD names) and bandwidths (kHz, as the radio writes them)
const BAND_DEMODS = {FM: ["WFM", "STEREO", "MONO"], AM: ["AM", "SSB"], SW: ["AM", "SSB", "LSB", "USB"], LW: ["AM"],
  AIR: ["AM", "NFM"], VHF: ["NFM", "AM", "WFM"], UHF: ["NFM", "AM", "WFM"], CB: ["NFM", "AM"]};
const BWS = {WFM: ["AUTO"], STEREO: ["AUTO"], MONO: ["AUTO"], NFM: ["12.5K", "25K"], AM: ["4.0K", "6.0K", "3.0K", "2.0K"],
  SSB: ["2.4K", "3.0K"], LSB: ["2.4K", "3.0K"], USB: ["2.4K", "3.0K"]};
const START = {FM: 100100, AM: 999, SW: 9580, LW: 198, AIR: 118100, VHF: 145500, UHF: 446006, CB: 27185};
export const VOL_MAX = 30, SQ_MAX = 9, SIGNAL_MS = 2000, SCAN_MS = 3000, SEEK_FRAME_MS = 80;
const TEXT_MAX = 13;  // text bytes per frame, so a frame stays within MAX_FRAME (20)

const K = {BAND: 0x00, UP: 0x0E, UP_LONG: 0x0F, DOWN: 0x10, DOWN_LONG: 0x11, VOL_UP: 0x12, VOL_DOWN: 0x13,
  POWER: 0x14, SUBBAND: 0x17, PLAY: 0x1A, STEP: 0x1B, BLUETOOTH: 0x1C, DEMOD: 0x1D, BANDWIDTH: 0x1E, DISPLAY: 0x1F,
  SQ: 0x20, STEREO: 0x21, DE: 0x22, MUSIC: 0x26, BAND_LONG: 0x29, SOS: 0x2A, REC: 0x2D, ALARM: 0x31, PLAY_LONG: 0x33,
  VOL_UP_LONG: 0x44, VOL_DOWN_LONG: 0x43, POWER_LONG: 0x45};
// What the radio says for the keys it has no screen for here
const ACKS = {[K.BLUETOOTH]: "BT", [K.MUSIC]: "MUSIC", [K.SOS]: "SOS", [K.DISPLAY]: "LIGHT", [K.DE]: "DE-EMP 50US", 0x27: "LOOP",
  0x2E: "FUNC", 0x2F: "FUNC", 0x30: "FUNC", 0x34: "LOCK", 0x32: "ALARM", 0x2B: "SOS"};

export class VirtualRadio extends RadioSim {
  constructor(emit, hooks = {}, saved = null) {
    super(emit);
    Object.assign(this, {hooks, on: true, vol: 8, sq: 0, rec: false, alarm: false, scanTimer: 0, seekTimer: 0, signalTimer: 0,
      steps: {}, demods: {}, bws: {}});
    this.band = "SW"; this.kHz = START.SW;
    if (saved) this.restore(saved);
  }

  // ---- what's kept between visits ----
  toJSON() {
    return {band: this.band, kHz: this.kHz, last: this.last, bank: [...this.bank], vol: this.vol, sq: this.sq, on: this.on,
      steps: this.steps, demods: this.demods, bws: this.bws};
  }
  restore(s) {
    if (VR_BANDS.includes(s.band) && inBand(s.band, s.kHz)) { this.band = s.band; this.kHz = s.kHz; }
    for (const [b, k] of Object.entries(s.last || {})) if (VR_BANDS.includes(b) && inBand(b, k)) this.last[b] = k;
    for (const [key, k] of Array.isArray(s.bank) ? s.bank : []) {
      const [b, ch] = String(key).split(":");
      if (VR_BANDS.includes(b) && +ch >= 1 && +ch <= MAX_CH && inBand(b, k)) this.bank.set(memKey(b, +ch), k);
    }
    if (s.vol >= 0 && s.vol <= VOL_MAX) this.vol = s.vol;
    if (s.sq >= 0 && s.sq <= SQ_MAX) this.sq = s.sq;
    if (typeof s.on === "boolean") this.on = s.on;
    for (const f of ["steps", "demods", "bws"]) if (s[f] && typeof s[f] === "object") this[f] = {...s[f]};
  }
  changed() { if (this.hooks.save) this.hooks.save(); }

  // ---- the radio's side ----
  step() { const s = BAND_STEPS[this.band] || [1]; return s[this.steps[this.band] || 0] || s[0]; }
  demod() { const d = BAND_DEMODS[this.band] || ["AM"]; return d[this.demods[this.band] || 0] || d[0]; }
  bw() { const b = BWS[this.demod()] || ["AUTO"]; return b[this.bws[this.band] || 0] || b[0]; }

  // A text field (1C) or a button label (21), split as the radio splits it: seg 3 whole, else 1 … 2 … 4
  text(cmd, slot, str) {
    const b = [...str].map((c) => c.charCodeAt(0) & 0xFF);
    if (b.length <= TEXT_MAX) { this.emit(frame(cmd, [slot, 3, b.length, ...b])); return; }
    for (let i = 0; i < b.length; i += TEXT_MAX) {
      const part = b.slice(i, i + TEXT_MAX), seg = i === 0 ? 1 : i + TEXT_MAX >= b.length ? 4 : 2;
      this.emit(frame(cmd, [slot, seg, part.length, ...part]));
    }
  }
  field(slot, str) { this.text(0x1C, slot, str); }

  // Everything the real radio sends on connect: what it is, its state, its labels, where it is
  hello() {
    this.emit(frame(0x20, [1]));                                 // language: en
    this.emit(frame(0x08, [3, 0]));                              // battery 3/3
    this.emit(frame(0x15, [bandMask() & 255, bandMask() >> 8])); // bands
    this.emit(frame(0x17, [1, 1, 1]));                           // MODE, STEP, SCAN buttons enabled
    this.emit(frame(0x18, [90, SQ_MAX]));                        // limits: sleep, squelch
    ["BW-DM", "STEP", "SCAN", "SOS", "FUNC"].forEach((t, i) => this.text(0x21, i + 1, t));
    this.field(1, "Demodulation"); this.field(3, "BandWidth"); this.field(5, "SNR"); this.field(7, "RSSI"); this.field(9, "SQL");
    this.power();
    this.settings();
    this.preset(0, 0);
    this.sendFreq();
    this.startSignal();
  }
  power() {
    this.emit(frame(0x13, [this.on ? 0 : 1]));
    this.emit(frame(0x07, [this.on ? 2 : 0]));                   // radio / standby
  }
  // Demodulation, bandwidth, squelch, volume and the two info rows
  settings() {
    const dm = this.demod();
    this.emit(frame(0x04, [DEMOD.indexOf(dm), 0, 0, 0, 0, 0, 0, 0]));
    this.field(2, dm); this.field(4, this.bw());
    this.field(10, this.sq ? String(this.sq) : "OFF");
    this.emit(frame(0x09, [this.vol]));
    this.field(13, String(this.vol));
    this.field(11, `VOL:${this.vol}  STEP:${this.step()}K  ATT:DX`);
    this.field(12, `ANT:AUTO  EQ:NORMAL  ${this.rec ? "REC" : "VIRTUAL"}`);
  }
  // RSSI and SNR every SIGNAL_MS, from hooks.signal; nothing comes in in standby or below the squelch
  startSignal() {
    clearInterval(this.signalTimer);
    this.signalTimer = setInterval(() => this.sendSignal(), SIGNAL_MS);
    this.sendSignal();
  }
  sendSignal() {
    if (!this.on) return;
    const s = Math.max(0, Math.min(1, (this.hooks.signal ? this.hooks.signal(this.kHz, this.band) : 0) + (Math.random() - .5) * .06));
    let rssi = Math.round(4 + s * 56 + Math.random() * 3), snr = Math.max(0, Math.round(s * 30 - 2 + Math.random() * 2));
    if (this.sq && rssi < this.sq * 6) snr = 0;
    this.field(6, String(snr)); this.field(8, String(rssi));
  }
  stop() { clearInterval(this.signalTimer); this.stopScan(); clearTimeout(this.seekTimer); clearTimeout(this.storeTimer); }

  // ---- tuning ----
  // Shortwave as the RF919 sends it: 10 Hz units, 2 or 1 integer digits (11620 kHz → 1162000, "11.6200" on the display)
  sendFreq() {
    if (this.band !== "SW") return super.sendFreq();
    const raw = this.kHz * 100, dp = 0x10 | (String(raw).length - 5);
    this.emit(frame(0x01, [BAND_CODES.SW, raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24, 0, dp, 0]));
  }
  setFreq(k) { this.kHz = k; this.sendFreq(); this.changed(); }
  stepBy(dir) {
    const [, lo, hi] = bandRange(this.band), st = this.step();
    const g = this.kHz / st;                              // one step, or onto the step grid when off it
    let k = (Number.isInteger(g) ? g + dir : dir > 0 ? Math.ceil(g) : Math.floor(g)) * st;
    if (k > hi) k = lo; else if (k < lo) k = hi;          // wraps, as the radio does
    this.setFreq(k);
  }
  // To the next station: the frequency runs there in a few frames, as on the radio's display
  seek(dir) {
    const [, lo, hi] = bandRange(this.band);
    let to = this.hooks.seek ? this.hooks.seek(this.band, this.kHz, dir) : null;
    if (to == null) to = Math.min(hi, Math.max(lo, this.kHz + dir * 10 * this.step()));
    clearTimeout(this.seekTimer);
    const from = this.kHz, n = 5, st = this.step();
    let i = 0;
    const run = () => {
      i++;
      const k = i >= n ? to : Math.round((from + (to - from) * i / n) / st) * st;
      this.kHz = k; this.sendFreq();
      if (i < n) this.seekTimer = setTimeout(run, SEEK_FRAME_MS); else this.changed();
    };
    run();
  }
  startScan() {
    this.toast("SCAN");
    const next = () => { this.seek(1); this.scanTimer = setTimeout(next, SCAN_MS); };
    this.scanTimer = setTimeout(next, 300);
  }
  stopScan() { if (!this.scanTimer) return false; clearTimeout(this.scanTimer); this.scanTimer = 0; return true; }
  nextBand(dir = 1) {
    const i = VR_BANDS.indexOf(this.band), b = VR_BANDS[(i + dir + VR_BANDS.length) % VR_BANDS.length];
    this.last[this.band] = this.kHz;
    this.band = b; this.kHz = this.last[b] || START[b]; this.mode = null;
    this.preset(0, 0);
    this.settings();
    this.setFreq(this.kHz);
  }
  // Recall mode: ◀ ▶ go through the band's stored channels
  stepChannel(dir) {
    const chs = [...this.bank.keys()].filter((k) => k.startsWith(this.band + ":")).map((k) => +k.split(":")[1]).sort((a, b) => a - b);
    if (!chs.length) { this.toast("NULL"); return; }
    const cur = this.ch || 0, ch = dir > 0 ? chs.find((c) => c > cur) ?? chs[0] : [...chs].reverse().find((c) => c < cur) ?? chs.at(-1);
    this.ch = ch; this.setFreq(this.bank.get(memKey(this.band, ch))); this.preset(1, ch);
  }

  // ---- what the page sends ----
  receive(pkt) {
    const cmd = pkt[2], d = pkt.slice(3, -1);
    if (cmd === 0x0D) return;                                   // the clock: nothing to show
    const key = cmd === 0x0C ? d[0] : null;
    if (!this.on) {                                             // standby: only POWER wakes it
      if (key === K.POWER || key === K.POWER_LONG) { this.on = true; this.power(); this.sendFreq(); this.changed(); }
      return;
    }
    if (this.scanTimer && (cmd === 0x10 || key !== null)) {     // any key or tune stops a scan
      this.stopScan();
      if (key === K.PLAY) { this.toast("SCAN STOP"); return; }
    }
    if (cmd === 0x10) {
      const band = BANDS[d[0]], raw = (d[1] | d[2] << 8 | d[3] << 16 | d[4] << 24) >>> 0;
      if (!VR_BANDS.includes(band)) return;
      if (!raw && !this.last[band] && band !== this.band) this.last[band] = START[band];  // a band not visited yet
      super.receive(pkt);
      this.settings(); this.changed();
      return;
    }
    if (key === null) return;
    const before = this.bank.size;
    switch (key) {
      case K.UP: case K.DOWN: {
        const dir = key === K.UP ? 1 : -1;
        if (this.mode === "store") { this.shown = ((this.shown || 1) - 1 + dir + MAX_CH) % MAX_CH + 1; this.preset(2, this.shown); return; }
        if (this.mode === "recall") return this.stepChannel(dir);
        if (this.mode === "entry") { this.mode = null; this.buf = ""; this.echo(0); }
        return this.stepBy(dir);
      }
      case K.UP_LONG: case K.DOWN_LONG: this.mode = null; return this.seek(key === K.UP_LONG ? 1 : -1);
      case K.PLAY: this.mode = null; return this.startScan();
      case K.BAND: return this.nextBand(1);
      case K.BAND_LONG: return this.nextBand(-1);
      case K.VOL_UP: case K.VOL_DOWN: case K.VOL_UP_LONG: case K.VOL_DOWN_LONG: {
        const by = (key === K.VOL_UP ? 1 : key === K.VOL_DOWN ? -1 : key === K.VOL_UP_LONG ? 5 : -5);
        this.vol = Math.max(0, Math.min(VOL_MAX, this.vol + by));
        this.emit(frame(0x09, [this.vol])); this.field(13, String(this.vol));
        this.field(11, `VOL:${this.vol}  STEP:${this.step()}K  ATT:DX`);
        return this.changed();
      }
      case K.SQ: this.sq = (this.sq + 1) % (SQ_MAX + 1); this.settings(); this.toast(this.sq ? `SQL ${this.sq}` : "SQL OFF"); return this.changed();
      case K.STEP: {
        const s = BAND_STEPS[this.band] || [1];
        this.steps[this.band] = ((this.steps[this.band] || 0) + 1) % s.length;
        this.settings(); this.toast(`STEP ${this.step()}K`); return this.changed();
      }
      case K.DEMOD: case K.STEREO: case K.SUBBAND: {        // SUBBAND: the MODE button, labelled BW-DM
        const list = BAND_DEMODS[this.band] || ["AM"];
        this.demods[this.band] = ((this.demods[this.band] || 0) + 1) % list.length; this.bws[this.band] = 0;
        this.settings(); return this.changed();
      }
      case K.BANDWIDTH: {
        const list = BWS[this.demod()] || ["AUTO"];
        this.bws[this.band] = ((this.bws[this.band] || 0) + 1) % list.length;
        this.settings(); return this.changed();
      }
      case K.POWER: case K.POWER_LONG: this.on = false; this.stopScan(); this.power(); return this.changed();
      case K.REC: this.rec = !this.rec; this.field(16, this.rec ? "REC" : ""); this.settings(); this.toast(this.rec ? "REC" : "REC STOP"); return;
      case K.ALARM: this.alarm = !this.alarm; this.emit(frame(0x06, [0, 7, 0, this.alarm ? 1 : 0])); this.toast(this.alarm ? "ALARM 07:00" : "ALARM OFF"); return;
      case K.PLAY_LONG: this.mode = null; super.receive(pkt); this.toast("CLEAR"); return this.changed();
    }
    if (ACKS[key]) { this.toast(ACKS[key]); return; }
    const wasMode = this.mode;
    super.receive(pkt);                                         // keypad, FREQ, MEMO short/long, BACK
    if (key === 0x24 && this.mode === "recall" && wasMode !== "recall") this.ch = this.proposal() - 1;  // where recall opens
    if (this.bank.size !== before || (wasMode && !this.mode)) this.changed();
  }
  // FREQ in recall mode: the channel typed becomes the one ◀ ▶ go on from
  recall() { const ch = +this.buf; super.recall(); if (this.bank.has(memKey(this.band, ch))) this.ch = ch; this.changed(); }
}

const inBand = (b, k) => { const r = bandRange(b); return !!r && k >= r[1] && k <= r[2]; };
// 15: one bit per band, in BANDS' order
function bandMask() {
  return Object.values(BANDS).reduce((m, b, i) => VR_BANDS.includes(b) ? m | 1 << i : m, 0);
}
