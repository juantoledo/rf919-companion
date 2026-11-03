// ---- RF919 protocol (see PROTOCOL.md) ----
// Full 128-bit UUID strings: some Web Bluetooth implementations (e.g. iOS browsers) mishandle 16-bit integers
export const uuid16 = (n) => `0000${n.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
export const SERVICE = uuid16(0xff12), WRITE_CHAR = uuid16(0xff13), NOTIFY_CHAR = uuid16(0xff14);
// Longest frame seen: 20 bytes (one BLE notification). The radio splits text into 13–14 byte chunks to stay within it.
export const MAX_FRAME = 20;

export const BANDS = {0x00:"FM",0x01:"AM",0x02:"SW",0x03:"AIR",0x04:"CB",0x05:"UHF",0x06:"WB",0x07:"VHF",0x08:"LW",
  0x09:"HAM",0x10:"RAIL",0x11:"MRN",0x12:"RACE",0x13:"POL",0x14:"FIRE",0x15:"OTHER"};
export const BAND_CODES = Object.fromEntries(Object.entries(BANDS).map(([k, v]) => [v, +k]));

// PRESET: the vendor app's key 23 does nothing on the RF919 (✓ live); the radio's Memo button, short, switches its
// channel (preset) mode, so the page's recall uses MEMO short too
export const KEYS = {BAND:0x00, 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, 0:0x0A, BACK:0x0B, POINT:0x0C, FREQ:0x0D,
  UP:0x0E, UP_LONG:0x0F, DOWN:0x10, DOWN_LONG:0x11, "VOL+":0x12, "VOL-":0x13, POWER:0x14, SUBBAND:0x17,
  PLAY:0x1A, SCAN:0x1A, STEP:0x1B, BLUETOOTH:0x1C, DEMOD:0x1D, BANDWIDTH:0x1E, DISPLAY:0x1F, SQ:0x20, STEREO:0x21, DE:0x22,
  PRESET:0x24, MEMO:0x24, MUSIC:0x26, CIRCLE:0x27, BAND_LONG:0x29, SOS:0x2A, SOS_LONG:0x2B, MEMO_LONG:0x2C,
  REC:0x2D, FUNC3:0x2E, FUNC4:0x2F, FUNC5:0x30, ALARM:0x31, ALARM_LONG:0x32, PLAY_LONG:0x33, FUNC_LONG:0x34,
  POWER_LONG:0x45};
// Long-press variants (key name or raw code)
// SCAN has no entry on purpose: holding SCAN/ATS (33) deletes every memory of the band (user report), so the
// Scan buttons send 1A however long they're held. Holding Play (also 1A) still sends 33, after a confirmation
export const LONG = {BAND:"BAND_LONG", UP:"UP_LONG", DOWN:"DOWN_LONG", PLAY:"PLAY_LONG", SOS:"SOS_LONG",
  DISPLAY:"FUNC_LONG", MEMO:"MEMO_LONG", ALARM:"ALARM_LONG", POWER:"POWER_LONG", "VOL+":0x44, "VOL-":0x43,
  1:0x35, 2:0x36, 3:0x37, 4:0x38, 5:0x39, 6:0x3A, 7:0x3B, 8:0x3C, 9:0x3D, 0:0x3E};
// Buttons the radio relabels via opcode 21: slot name -> key sent
export const FUNC_BUTTONS = {MODE:"SUBBAND", STEP:"STEP", SCAN:"PLAY", SOS:"SOS", FUNC:"DISPLAY"};

export const DEMOD = ["WFM","NFM","MONO","STEREO","AM","SSB","LSB","USB"];
export const MODES = {0:"standby",1:"TF/MP3",2:"radio",3:"standby",4:"BT audio",6:"PC/USB",7:"AUX"};
export const EQ = ["normal","pop","rock","jazz","classic","country"];
export const REPEAT = ["all","one","folder","shuffle"];
export const TEXT_SLOTS = {1:"demod_label",2:"demod",3:"bw_label",4:"bw",5:"snr_label",6:"snr",7:"rssi_label",8:"rssi",
  9:"field9",10:"field10",11:"field11",12:"field12",13:"volume",14:"track",15:"field15",16:"rec"};
export const BUTTON_SLOTS = {1:"MODE",2:"STEP",3:"SCAN",4:"SOS",5:"FUNC"};
export const BLINK_STATES = ["steady","steady","blink"];

export const hex = (bytes) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(" ");
export const pad2 = (n) => String(n).padStart(2, "0");

export function frame(cmd, data = []) {
  const body = [0xAB, data.length + 1, cmd, ...data];
  return Uint8Array.from([...body, body.reduce((a, b) => a + b, 0) & 0xFF]);
}

export function formatFreq(raw, dp) {
  const lo = dp & 0x0F, hi = dp >> 4, digits = String(raw), intDigits = lo - hi + 1;
  if (lo === 0 || !(intDigits > 0 && intDigits < digits.length)) return digits;
  return digits.slice(0, intDigits) + "." + digits.slice(intDigits);
}

// (main, small): the app's 6 big digit slots + 1 small slot
export function splitFreq(raw, dp) {
  const lo = dp & 0x0F, hi = dp >> 4, digits = String(raw);
  const first = Math.max(hi - 1, 0);
  let main = digits.slice(0, 6 - first);
  const small = digits.slice(6 - first);
  const intDigits = lo - hi + 1;
  if (lo && intDigits > 0 && intDigits < main.length) main = main.slice(0, intDigits) + "." + main.slice(intDigits);
  return [main, small];
}

export class RangeErr extends Error {}

export class Decoder {
  constructor() {
    this.buf = []; this.chunks = new Map();
    try { this.gbk = new TextDecoder("gbk"); } catch { this.gbk = new TextDecoder(); }  // labels are ASCII in English mode
  }

  *feed(data) {
    this.buf.push(...data);
    while (true) {
      const start = this.buf.indexOf(0xAB);
      if (start < 0) { this.buf = []; return; }
      this.buf.splice(0, start);
      if (this.buf.length < 2) return;
      const n = this.buf[1] + 3;
      if (n > MAX_FRAME) {
        // A real frame always fits one notification; waiting for this one would stall the display
        yield {kind: "bad_frame", data: {}, text: `! frame too long (${n} bytes), resyncing`, raw: Uint8Array.from(this.buf.slice(0, 2))};
        this.buf.splice(0, 1);
        continue;
      }
      if (this.buf.length < n) return;
      const pkt = Uint8Array.from(this.buf.slice(0, n));
      const sum = pkt.slice(0, -1).reduce((a, b) => a + b, 0) & 0xFF;
      if (sum !== pkt[n - 1]) {
        // Not a real frame start: skip this 0xAB only, so frames buffered after it survive
        yield {kind: "bad_checksum", data: {}, text: "! bad checksum, resyncing " + hex(pkt), raw: pkt};
        this.buf.splice(0, 1);
        continue;
      }
      this.buf.splice(0, n);
      const ev = this.decode(pkt[2], pkt.slice(3, -1));
      ev.raw = pkt;
      if (ev.kind === "unknown") ev.text = `cmd ${pad2(pkt[2].toString(16))}: ${hex(pkt)}`;
      if (ev.kind !== "partial") yield ev;
    }
  }

  text(key, seg, chunk) {
    if (seg === 1 || seg === 3) this.chunks.set(key, []);
    if (!this.chunks.has(key)) this.chunks.set(key, []);
    this.chunks.get(key).push(...chunk);
    if (seg === 3 || seg === 4) {
      const t = this.gbk.decode(Uint8Array.from(this.chunks.get(key)));
      this.chunks.delete(key);
      return t;
    }
    return null;
  }

  decode(cmd, d) {
    try { return this._decode(cmd, d); }
    catch (e) { if (e instanceof RangeErr) return {kind: "unknown", data: {cmd}, text: ""}; throw e; }
  }

  _decode(cmd, d) {
    const b = (i) => { if (i >= d.length) throw new RangeErr(); return d[i]; };
    const u16 = (i) => b(i) | b(i + 1) << 8;
    const pick = (arr, i) => { if (i >= arr.length) throw new RangeErr(); return arr[i]; };
    const E = (kind, data = {}, text = "") => ({kind, data, text});
    if (cmd === 0x01 || cmd === 0x0F) {
      const off = cmd === 0x0F ? 1 : 0;
      const band = b(off), raw = (b(off + 1) | b(off + 2) << 8 | b(off + 3) << 16 | b(off + 4) << 24) >>> 0;
      const unit = pick(["MHz", "kHz"], b(off + 5)), dp = b(off + 6);
      const state = d.length > off + 7 ? d[off + 7] : 0;
      const kind = cmd === 0x0F ? "entry" : "freq";
      const name = BANDS[band] ?? pad2(band.toString(16));
      const alert = band === 0x06 && raw === 0xFF000000;
      const data = {band: name, raw, dp, unit, state, text: formatFreq(raw, dp), alert};
      if (cmd === 0x0F) data.result = d[0];
      if (alert) return E(kind, data, "freq: WB ALERT");
      const prefix = cmd === 0x0F ? `entry[${d[0]}] ` : "";
      return E(kind, data, `${prefix}freq: ${name} ${data.text} ${unit} (raw=${raw}, dp=${pad2(dp.toString(16))})`);
    }
    switch (cmd) {
      case 0x03: return E("rssi_snr", {rssi: b(0), snr: b(1)}, `rssi=${d[0]} snr=${d[1]}`);
      case 0x04: { const dm = b(0) < DEMOD.length ? DEMOD[d[0]] : String(d[0]);
        return E("demod", {demod: dm, bw: u16(6)}, `demod=${dm} bw=${u16(6)}`); }
      case 0x05: return E("sleep", {minutes: b(0)}, d[0] ? `sleep timer: ${d[0]} min left` : "sleep timer off");
      case 0x06: b(3); return E("alarm", {hour: d[1], minute: d[2], state: d[3]}, `alarm ${pad2(d[1])}:${pad2(d[2])} state=${d[3]}`);
      case 0x07: { const m = MODES[b(0)] ?? String(d[0]); return E("mode", {mode: m}, `mode=${m}`); }
      case 0x08: b(1); return E("battery", {level: d[0], charging: d[1] === 1}, `battery=${d[0]}/3${d[1] === 1 ? " charging" : ""}`);
      case 0x09: return E("volume", {volume: b(0)}, `volume=${d[0]}`);
      case 0x0A: { const q = b(0) < EQ.length ? EQ[d[0]] : String(d[0]); return E("eq", {eq: q}, `eq=${q}`); }
      case 0x0C: return E("tracks", {track: u16(0), total: u16(2)}, `track ${u16(0)}/${u16(2)}`);
      case 0x0D: { const s = u16(0), t = u16(4);
        return E("track_time", {seconds: s, track: t}, `track #${t} ${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`); }
      case 0x0E: return E("playing", {playing: b(0) === 1}, d[0] === 1 ? "playing" : "paused");
      case 0x10: b(1); return E("preset", {state: d[0], n: d[1]}, `preset state=${d[0]} n=${d[1]}`);
      case 0x11: { const r = b(0) < REPEAT.length ? REPEAT[d[0]] : String(d[0]); return E("repeat", {repeat: r}, `repeat=${r}`); }
      case 0x13: return E("power", {state: b(0)}, `power-state=${d[0]}`);
      case 0x15: { const mask = u16(0); const bands = Object.values(BANDS).filter((_, i) => mask >> i & 1);
        return E("bands", {bands}, "bands: " + bands.join(",")); }
      case 0x16: return E("fw", {version: b(0)}, `fw version=${d[0]}`);
      case 0x17: { b(2); const en = {MODE: d[0] === 1, STEP: d[1] === 1, SCAN: d[2] === 1};
        return E("buttons_enabled", en, "buttons enabled: " + Object.entries(en).map(([k, v]) => `${k}=${+v}`).join(" ")); }
      case 0x18: b(1); return E("limits", {sleep_max: d[0], sq_max: d[1]}, `limits: sleep_max=${d[0]} sq_max=${d[1]}`);
      case 0x1E: { const vis = pick(["hidden", "visible", "blink"], b(1)); return E("row_vis", {row: d[0], state: vis}, `info row ${d[0]} ${vis}`); }
      case 0x1F: b(1); return E("sq_popup", {a: d[0], b: d[1]}, `squelch popup a=${d[0]} b=${d[1]}`);
      case 0x20: { const lang = b(0) === 0 ? "zh" : "en"; return E("language", {language: lang}, `language=${lang}`); }
      case 0x22: { b(1); const name = {1: "SOS", 2: "FUNC"}[d[0]] ?? String(d[0]);
        return E("button_blink", {button: name, blink: d[1] === 1}, `${name} blink ${d[1] === 1 ? "on" : "off"}`); }
      case 0x24: return E("disconnect_req", {}, "radio requested disconnect");
      case 0x12: case 0x19: case 0x23: {
        const t = this.text(cmd, b(0), d.slice(2, 2 + b(1)));
        if (t === null) return E("partial");
        const kind = {0x12: "status_text", 0x19: "version", 0x23: "toast"}[cmd];
        return E(kind, {text: t}, `${kind}: ${t}`);
      }
      case 0x1C: case 0x21: {
        const slot = b(0);
        const t = this.text(`${cmd}:${slot}`, b(1), d.slice(3, 3 + b(2)));
        if (t === null) return E("partial");
        const label = (cmd === 0x1C ? TEXT_SLOTS : BUTTON_SLOTS)[slot] ?? `slot${slot}`;
        return E(cmd === 0x1C ? "field" : "button_label", {slot, name: label, value: t}, `${label} = '${t}'`);
      }
      case 0x1D: { const name = TEXT_SLOTS[b(0)] ?? `slot${d[0]}`; const st = pick(BLINK_STATES, b(1));
        return E("blink", {slot: d[0], name, blink: st === "blink"}, `${name} ${st}`); }
    }
    return E("unknown", {cmd});
  }
}

export const DEMO = "ab021300c0 ab022001ce ab020702b6 ab02054bfd ab0506000c0100c3 ab03080300b9 ab0315ff01c3 ab03185a0929 ab1119010e204669726d77617265207665727321 ab1119020e696f6e3a312e3931300a204d6f64a8 ab1119020e656c3a52463931390a20436f7079f0 ab1119020e6d61696c3a737570706f7274406988 ab0c19040972616464792e636f6d5e ab101c01030c44656d6f64756c6174696f6ecc ab0d1c03030942616e64576964746858 ab071c050303534e52cc ab081c070304525353491e ab071c09030353514ccd ab071c0a03034f4646b9 ab071c09030353514ccd ab051c0603013006 ab051c080301340c ab111c0b010d564f4c3a342020535445503a3137 ab111c0b020d2e304b202044452d454d503a35e2 ab111c0b020d30555320204154543a4458202009 ab081c0b04044d4f4e4f1b ab111c0c010d4d49583a44495341424c4520204e ab111c0c020d414e543a4155544f202045513a59 ab111c0c020d4e4f524d414c202054454d505284 ab0e1c0c040a41545552453a3231a1e694 ab031d0b01d7 ab031d0c01d8 ab061c020302414d62 ab081c040304342e304bb7 ab0d1c03030942616e64576964746858 ab071c0a03034f4646b9 ab071c09030353514ccd ab111c0b010d564f4c3a342020535445503a3137 ab09010210bb1100001200a5 ab092101030542572d444d35 ab0b21020307414e542d415454dc ab0921030305562d55484646 ab0417010101c9 ab08210403044d5554451a ab08210503044c4f434b09 ab03100000be ab03220100d1 ab03220200d2";
export const fromHex = (s) => Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
