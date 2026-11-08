import {BAND_CODES, DEMO, Decoder, KEYS, NOTIFY_CHAR, SERVICE, WRITE_CHAR, frame, fromHex, hex, uuid16} from "./protocol.js";
import {MEMO_CFG, RadioSim, typeEntry} from "./memories.js";
import {VirtualRadio} from "./virtual.js";
import {waiters} from "./state.js";

// ---- Links ----
// Diagnostics, set from More › Tools › Log. rawRx: log every notification before decoding (catches bytes the decoder
// would drop). extra: also listen on the radio's other notifying channels, which the vendor app never uses: FFF1
// (service FF10) and the standard battery level. Only notifications are turned on and values read; nothing is
// written to those characteristics. extra needs a new device pick (Disconnect, then Connect) for the browser to grant them
export const linkOpts = {rawRx: false, extra: false};
const EXTRA_CHANNELS = [{name: "FFF1", svc: uuid16(0xff10), chr: uuid16(0xfff1)}, {name: "battery", svc: uuid16(0x180f), chr: uuid16(0x2a19)}];
const bytesOf = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const errText = (e) => `${e && e.name && e.name !== "Error" ? e.name + ": " : ""}${(e && e.message) || e}`;
export const charProps = (c) => ["read", "write", "writeWithoutResponse", "notify", "indicate"]
  .filter(p => c.properties && c.properties[p]).join(", ") || "(none reported)";

export class BaseLink {
  constructor(onEvent, onStatus) { this.onEvent = onEvent; this.onStatus = onStatus; }
  debug(text) { this.onEvent({kind: "debug", data: {}, text, raw: new Uint8Array()}); }
  press(key) { const code = typeof key === "number" ? key : KEYS[key]; return this.send(frame(0x0C, [code])); }
  tune(band, raw = 0) { return this.send(frame(0x10, [BAND_CODES[band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24])); }
  setTime(n = new Date()) {
    return this.send(frame(0x0D, [n.getHours(), n.getMinutes(), n.getSeconds(), n.getFullYear() - 1970, n.getMonth() + 1, n.getDate()]));
  }
  // One key per echo from the radio (see typeEntry)
  typeFreq(text) { return typeEntry(this, waiters, text, MEMO_CFG, false); }
}

export class BleLink extends BaseLink {
  constructor(onEvent, onStatus) {
    super(onEvent, onStatus);
    this.device = null; this.tx = null; this.queue = Promise.resolve(); this.userClosed = false;
    this.onNotify = (e) => {
      const v = e.target.value;
      if (!this.rxCount++) this.debug(`first notification received (${v.byteLength} bytes)`);
      if (linkOpts.rawRx) this.onEvent({kind: "rx", data: {}, text: `RX FF14 ${hex(bytesOf(v))}`, raw: new Uint8Array()});
      for (const ev of this.decoder.feed(bytesOf(v))) this.onEvent(ev);
    };
    this.onDrop = () => this.dropped();
  }
  get connected() { return !!(this.device && this.device.gatt.connected && this.tx); }

  async pick(acceptAll) {
    const services = [SERVICE, ...(linkOpts.extra ? EXTRA_CHANNELS.map((c) => c.svc) : [])];
    this.extraGranted = linkOpts.extra;
    const opts = acceptAll ? {acceptAllDevices: true, optionalServices: services}
                           : {filters: [{namePrefix: "RF919"}, {services: [SERVICE]}], optionalServices: services};
    this.debug(`requestDevice ${JSON.stringify(opts)}`);
    try { this.device = await navigator.bluetooth.requestDevice(opts); }
    catch (e) { this.debug(`requestDevice failed: ${errText(e)}`); throw e; }
    this.debug(`picked "${this.device.name}" id=${this.device.id}`);
    this.device.addEventListener("gattserverdisconnected", this.onDrop);
  }

  async open() {
    this.userClosed = false;
    this.onStatus("busy", `connecting to ${this.device.name || "radio"}…`);
    // Each step is logged with its timing, and named on failure, to see where a browser gets stuck
    let step = "", t0 = 0;
    const begin = (name) => {
      if (step) this.debug(`✓ ${step} (${Date.now() - t0} ms)`);
      step = name; t0 = Date.now();
      this.debug(`→ ${name}…`);
    };
    try {
      begin("GATT connect");
      const server = await this.device.gatt.connect();
      begin("get service FF12");
      const svc = await server.getPrimaryService(SERVICE);
      begin("get characteristic FF13 (write)");
      this.tx = await svc.getCharacteristic(WRITE_CHAR);
      this.debug(`FF13 properties: ${charProps(this.tx)}`);
      begin("get characteristic FF14 (notify)");
      const rx = await svc.getCharacteristic(NOTIFY_CHAR);
      this.debug(`FF14 properties: ${charProps(rx)}`);
      begin("start notifications");
      this.decoder = new Decoder();
      this.rxCount = 0;
      rx.addEventListener("characteristicvaluechanged", this.onNotify);
      await rx.startNotifications();
      begin("handshake");
      await this.send(frame(0xFF));
      this.debug(`✓ ${step} (${Date.now() - t0} ms)`);
    } catch (e) {
      throw new Error(`${step}: ${errText(e)}`);
    }
    this.onStatus("ok", this.device.name || "connected");
    if (linkOpts.extra) this.listenExtra(server);
    // The radio answers the handshake with a state dump within ~1 s
    const sentAt = Date.now();
    setTimeout(() => {
      if (this.connected && !this.rxCount) this.debug(`no data from the radio ${Date.now() - sentAt} ms after handshake; notifications may not be arriving`);
    }, 3000);
  }

  // The diagnostic channels: read once, then log every notification. Failures only go to the log
  async listenExtra(server) {
    if (!this.extraGranted) { this.debug("FFF1/battery: Disconnect, then Connect again, so the browser grants them"); return; }
    this.extraHooked ??= new WeakSet();
    for (const c of EXTRA_CHANNELS) {
      try {
        const chr = await (await server.getPrimaryService(c.svc)).getCharacteristic(c.chr);
        this.debug(`${c.name} properties: ${charProps(chr)}`);
        if (chr.properties.read) {
          try { this.extraEvent(c.name, await chr.readValue(), "read"); } catch (e) { this.debug(`${c.name} read failed: ${errText(e)}`); }
        }
        if (chr.properties.notify || chr.properties.indicate) {
          if (!this.extraHooked.has(chr)) {
            chr.addEventListener("characteristicvaluechanged", (e) => this.extraEvent(c.name, e.target.value, "notify"));
            this.extraHooked.add(chr);
          }
          await chr.startNotifications();
          this.debug(`listening on ${c.name}`);
        }
      } catch (e) {
        this.debug(`${c.name}: ${errText(e)}`);
      }
    }
  }
  extraEvent(name, v, how) {
    const b = bytesOf(v), h = hex(b);
    const text = name === "battery" && b.length === 1 ? `RX battery ${b[0]}% (${how})` : `RX ${name} ${h || "(empty)"} (${how})`;
    this.onEvent({kind: "rx2", data: {ch: name, hex: h}, text, raw: new Uint8Array()});
  }

  async connect(acceptAll = false) {
    if (!this.device) await this.pick(acceptAll);
    this.connecting = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await this.open(); return; }
        catch (e) {
          this.tx = null;
          this.debug(`attempt ${attempt + 1} failed at ${e.message}`);
          if (attempt === 2) throw e;
          this.onStatus("busy", `try ${attempt + 1} failed (${e.message}), retrying…`);
          await sleep(1000 * 2 ** attempt);
        }
      }
    } finally {
      this.connecting = false;
    }
  }

  async dropped() {
    this.debug(`gattserverdisconnected${this.connecting ? " (during connect)" : this.userClosed ? " (requested)" : " (unexpected)"}`);
    this.tx = null;
    if (this.connecting) return;  // a failed attempt dropped the link; connect() is already retrying
    if (this.userClosed) { this.onStatus("bad", "disconnected"); return; }
    this.onStatus("busy", "connection lost, reconnecting…");
    try { await this.connect(); } catch { this.onStatus("bad", "disconnected (tap Reconnect)"); }
  }

  send(pkt) {
    if (!this.connected && pkt[2] !== 0xFF) return Promise.reject(new Error("not connected"));
    const job = this.queue.then(() => {
      const withResponse = !!this.tx.writeValueWithResponse;
      this.debug(`TX ${hex(pkt)}${withResponse ? "" : " (writeValue)"}`);
      return withResponse ? this.tx.writeValueWithResponse(pkt) : this.tx.writeValue(pkt);
    });
    this.queue = job.catch((e) => this.debug(`TX failed: ${errText(e)}`));
    return job;
  }

  // forget = drop the chosen device, so the next Connect opens the picker again
  async close(forget = false) {
    this.userClosed = true;
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    if (forget && this.device) { this.device.removeEventListener("gattserverdisconnected", this.onDrop); this.device = null; }
    this.tx = null;
    this.onStatus("bad", "disconnected");
  }
}

// Replays a recorded session; a RadioSim answers what the page sends. Once the page has sent something,
// the replay's own frequency and preset frames are skipped, so they don't undo the simulated radio
export const SIM_OWNS = new Set([0x01, 0x0F, 0x10]);
export class ReplayLink extends BaseLink {
  constructor(onEvent, onStatus) {
    super(onEvent, onStatus);
    this.connected = false; this.timer = null; this.simDecoder = new Decoder();
    this.sim = new RadioSim((pkt) => { for (const ev of this.simDecoder.feed(pkt)) this.onEvent(ev); });
  }
  async connect() {
    this.connected = true;
    this.onStatus("ok", "demo (replay)");
    const pkts = DEMO.split(" ").map(fromHex);
    const run = () => {
      const decoder = new Decoder();
      let i = 0;
      const step = () => {
        if (!this.connected) return;
        if (i >= pkts.length) { this.timer = setTimeout(run, 4000); return; }
        const pkt = pkts[i++];
        if (!(this.sim.active && SIM_OWNS.has(pkt[2]))) {
          if (linkOpts.rawRx) this.onEvent({kind: "rx", data: {}, text: `RX FF14 ${hex(pkt)} (demo)`, raw: new Uint8Array()});
          for (const ev of decoder.feed(pkt)) this.onEvent(ev);
        }
        this.timer = setTimeout(step, 40);
      };
      step();
    };
    run();
  }
  async send(pkt) {
    if (!this.connected) throw new Error("not connected");
    this.onEvent({kind: "link", data: {}, text: `demo: would send ${hex(pkt)}`, raw: pkt});
    setTimeout(() => { if (this.connected) this.sim.receive(pkt); }, 60);
  }
  async close() { this.connected = false; clearTimeout(this.timer); this.onStatus("bad", "disconnected"); }
}

// No radio: a virtual RF919 (virtual.js) behind the same interface as BleLink. It starts where it was left
// (saved: VirtualRadio.toJSON()), answers every frame the page sends, and calls hooks.save when its state changes.
// The reply comes ~60 ms after a send, about as fast as the real radio, so the Tuner and the memory runs pace alike
export class VirtualLink extends BaseLink {
  constructor(onEvent, onStatus, hooks = {}, saved = null) {
    super(onEvent, onStatus);
    this.connected = false; this.decoder = new Decoder();
    this.radio = new VirtualRadio((pkt) => {
      if (!this.connected) return;
      if (linkOpts.rawRx) this.onEvent({kind: "rx", data: {}, text: `RX FF14 ${hex(pkt)} (no radio)`, raw: new Uint8Array()});
      for (const ev of this.decoder.feed(pkt)) this.onEvent(ev);
    }, hooks, saved);
  }
  async connect() {
    this.connected = true;
    this.onStatus("ok", "no radio (virtual)");
    this.radio.hello();
  }
  async send(pkt) {
    if (!this.connected) throw new Error("not connected");
    this.onEvent({kind: "link", data: {}, text: `no radio: ${hex(pkt)}`, raw: pkt});
    setTimeout(() => { if (this.connected) this.radio.receive(pkt); }, 60);
  }
  async close() {
    if (!this.connected) return;
    this.connected = false; this.radio.stop();
    if (this.radio.hooks.save) this.radio.hooks.save();
    this.onStatus("bad", "disconnected");
  }
}
