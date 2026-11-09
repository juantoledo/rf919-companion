// Logic checks for the RF919 Companion: protocol frames, memory lists, the store/recall sequences against the
// simulated radio, backup text, EiBi targets. Run: npm test (or node --test tests/)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as protocol from "../docs/js/protocol.js";
import * as radiomap from "../docs/js/radiomap.js";
import * as memories from "../docs/js/memories.js";
import {Tuner} from "../docs/js/tuner.js";
import {NameIndex, norm} from "../docs/js/names.js";
import {Logbook, Signal, toAdif, toCsv, adifBand} from "../docs/js/logbook.js";
import * as propagation from "../docs/js/propagation.js";

const T = {...protocol, ...radiomap, ...memories};
const H = (b) => T.hex(b).toUpperCase();
let n = 0;
const deq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const ok = (name, fn) => { fn(); n++; console.log("✓", name); };

ok("frames match memory.md §5", () => {
  assert.equal(H(T.frame(0x0C, [0x2C])), "AB 02 0C 2C E5");
  assert.equal(H(T.frame(0x0C, [0x24])), "AB 02 0C 24 DD");
  assert.equal(H(T.frame(0x0C, [0x23])), "AB 02 0C 23 DC");
  assert.equal(H(T.frame(0x0C, [0x0D])), "AB 02 0C 0D C6");
  const tune = (k) => { const r = k * 100; return H(T.frame(0x10, [2, r & 255, r >> 8 & 255, r >> 16 & 255, r >>> 24])); };
  assert.equal(tune(5025), "AB 06 10 02 E4 AA 07 00 58");
  assert.equal(tune(6000), "AB 06 10 02 C0 27 09 00 B3");
  assert.equal(tune(9580), "AB 06 10 02 30 9E 0E 00 9F");
  assert.equal(tune(11620), "AB 06 10 02 10 BB 11 00 9F");
  assert.equal(tune(15140), "AB 06 10 02 10 1A 17 00 04");
  for (let ch = 1; ch <= 5; ch++) assert.equal(H(T.frame(0x0C, [T.KEYS[String(ch)]])), `AB 02 0C 0${ch} ${(0xB9 + ch).toString(16).toUpperCase()}`);
  deq([..."200"].map((d) => T.KEYS[d]), [0x02, 0x0A, 0x0A]);
});

ok("parser: memory.md §6 example", () => {
  const {entries, errors} = T.parseMemList("1  SW  5025\n2  SW  6000\n3  FM  101.3\n4  VHF 146.730\n");
  assert.equal(errors.length, 0);
  deq(entries.map((e) => [e.ch, e.band, e.kHz]), [[1, "SW", 5025], [2, "SW", 6000], [3, "FM", 101300], [4, "VHF", 146730]]);
});

ok("parser: optional channel, band, names, units, comments", () => {
  const {entries, errors} = T.parseMemList("# list\n9580 China Radio Int.\nFM 101.3 Radio Bio Bio\n12 9580\n146.73 MHz rep\n720 k\n");
  assert.equal(errors.length, 0);
  deq(entries.map((e) => [e.ch, e.band, e.kHz, e.name]), [
    [null, "SW", 9580, "China Radio Int."], [null, "FM", 101300, "Radio Bio Bio"], [12, "SW", 9580, ""],
    [null, "VHF", 146730, "rep"], [null, "AM", 720, ""]]);
});

ok("parser: channel 0 and 201 refused, WB refused, junk refused", () => {
  const {entries, errors} = T.parseMemList("201 SW 5025\n0 SW 5025\n200 SW 5025\nWB 162.55\nhello\n");
  deq(entries.map((e) => e.ch), [200]);
  deq(errors.map((e) => e.line), [1, 2, 4, 5]);
});

ok("list text round-trips (150.000 MHz stays MHz)", () => {
  const list = T.addToList([], [{band: "VHF", kHz: 150000, ch: 1}, {band: "SW", kHz: 9580, ch: 2, name: "CRI"}, {band: "FM", kHz: 101300, ch: 3}]).list;
  const back = T.parseMemList(T.listToText(list)).entries;
  deq(back.map((e) => [e.ch, e.band, e.kHz, e.name]), list.map((e) => [e.ch, e.band, e.kHz, e.name]));
});

ok("200 per band: auto-numbering per band, full band refuses the 201st", () => {
  const sw = Array.from({length: 201}, (_, i) => ({band: "SW", kHz: 5000 + i * 5, ch: null}));
  const fm = [{band: "FM", kHz: 101300, ch: null}];
  const {list, errors} = T.addToList([], [...sw, ...fm]);
  assert.equal(list.filter((e) => e.band === "SW").length, 200);
  assert.equal(Math.max(...list.filter((e) => e.band === "SW").map((e) => e.ch)), 200);
  assert.equal(list.find((e) => e.band === "FM").ch, 1);  // numbering restarts in each band
  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /SW is full \(200\/200\)/);
});

ok("explicit channels are kept; duplicates and 201 refused; autos fill the gaps", () => {
  const {list, errors} = T.addToList([], [{band: "SW", kHz: 1, ch: null}, {band: "SW", kHz: 2, ch: 1}, {band: "SW", kHz: 3, ch: 1},
    {band: "SW", kHz: 4, ch: 201}, {band: "SW", kHz: 5, ch: 2.5}]);
  deq(list.map((e) => [e.ch, e.kHz]), [[1, 2], [2, 1]]);
  assert.equal(errors.length, 3);
});

ok("bandFor", () => {
  deq([153, 720, 9580, 27185, 101300, 118100, 146730, 433000].map(T.bandFor), ["LW", "AM", "SW", "SW", "FM", "AIR", "VHF", "UHF"]);
});

ok("pool keeps order, turns failures into null", async () => {});
const got = await T.pool([1, 2, 3, 4, 5], 2, async (x) => { if (x === 3) throw new Error(); return x * 10; });
deq([...got], [10, 20, null, 40, 50]);

// ---- end to end: MemoryRun against the simulator, through a fake link and the real decoder ----
function rig() {
  const w = new T.Waiters(), dec = new T.Decoder(), sent = [];
  const sim = new T.RadioSim((pkt) => { for (const ev of dec.feed(pkt)) w.feed(ev); });
  const link = {
    async send(pkt) { sent.push(pkt); setTimeout(() => sim.receive(pkt), 5); },
    press(k) { return this.send(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]])); },
    tune(band, raw = 0) { return this.send(T.frame(0x10, [T.BAND_CODES[band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24])); },
    async typeFreq(text) { for (const k of ["FREQ", ...[...text].map((c) => c === "." ? "POINT" : c), "FREQ"]) { await this.press(k); await new Promise((r) => setTimeout(r, 2)); } },
  };
  sim.storeTimeoutMs = 300;
  sim.sendFreq();  // the radio's state dump
  const cfg = {...T.MEMO_CFG, stepMs: 2, pauseMs: 5, timeoutMs: 300, echoMs: 150};
  return {w, sim, link, sent, run: new T.MemoryRun(link, w, {cfg})};
}
await new Promise((r) => setTimeout(r, 20));
{
  const {sim, run, sent} = rig();
  await new Promise((r) => setTimeout(r, 20));
  const list = [{band: "SW", kHz: 5025, ch: 1}, {band: "SW", kHz: 9580, ch: 12}, {band: "FM", kHz: 101300, ch: 1}, {band: "VHF", kHz: 146730, ch: 200}];
  for (const e of list) await run.store(e);
  assert.equal(sim.bank.get("SW:1"), 5025);
  assert.equal(sim.bank.get("SW:12"), 9580);
  assert.equal(sim.bank.get("FM:1"), 101300);
  assert.equal(sim.bank.get("VHF:200"), 146730);
  // Channel 200 is typed as 02 0A 0A, then the confirm key
  const keys = sent.filter((p) => p[2] === 0x0C).map((p) => p[3]);
  assert.ok(T.hex(keys).includes("2c 02 0a 0a 24"));
  for (const e of list) deq(await run.recall(e.band, e.ch), {kHz: e.kHz, empty: false});
  deq(await run.recall("SW", 2), {kHz: null, empty: true});  // empty: the sim shows NULL
  n++; console.log("✓ store + recall against the simulator (SW, FM, VHF, channel 200, empty channel)");
}
{
  const {run, sent} = rig();
  await new Promise((r) => setTimeout(r, 20));
  const before = sent.length;
  await assert.rejects(run.store({band: "SW", kHz: 5025, ch: 201}), /outside 1–200/);
  await assert.rejects(run.recall("SW", 201), /outside 1–200/);
  assert.equal(sent.length, before);  // nothing was sent for 201
  n++; console.log("✓ the sequencer refuses channel 201 without sending anything");
}
{
  const {run, w} = rig();
  await new Promise((r) => setTimeout(r, 20));
  const p = run.store({band: "FM", kHz: 99900, ch: 3});
  setTimeout(() => run.stop(), 3);
  await assert.rejects(p, (e) => e instanceof T.CancelErr);
  assert.equal(w.set.size, 0);
  n++; console.log("✓ stop() cancels a run mid-step");
}
{
  // A radio that never confirms: the run fails with a named step instead of hanging
  const {run, sim} = rig();
  sim.save = function () { this.mode = null; };
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(run.store({band: "SW", kHz: 6000, ch: 4}), /no reply after confirm/);
  n++; console.log("✓ a missing confirm reply fails with \"no reply after confirm\"");
}
{
  // The live capture (fw 1.910, 2026-11-02): FM 87.50, MEMO long → 10 02 03, "1" → 10 02 01, MEMO → 01 FM 8750 + 10 00 00
  const w = new T.Waiters(), dec = new T.Decoder(), sent = [];
  const feed = (cmd, data) => { for (const ev of dec.feed(T.frame(cmd, data))) w.feed(ev); };
  const later = (f) => setTimeout(f, 30);
  const fm8750 = [0x00, 8750 & 255, 8750 >> 8, 0, 0, 0, 0x34, 0];
  const link = {
    async send(pkt) {
      sent.push(pkt);
      const key = pkt[3];
      if (key === 0x2C) later(() => feed(0x10, [2, 3]));
      else if (key === 0x01) later(() => feed(0x10, [2, 1]));
      else if (key === 0x24) later(() => { feed(0x01, fm8750); feed(0x10, [0, 0]); });
    },
    press(k) { return this.send(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]])); },
  };
  feed(0x01, fm8750);
  assert.equal(T.toKHz(w.freq), 87500);
  const run = new T.MemoryRun(link, w, {cfg: {...T.MEMO_CFG, stepMs: 2, timeoutMs: 300}});
  await run.store({band: "FM", kHz: 87500, ch: 1});
  deq(sent.map((p) => T.hex(p)), ["ab 02 0c 2c e5", "ab 02 0c 01 ba", "ab 02 0c 24 dd"]);
  n++; console.log("✓ the live capture passes: MEMO long, 1, MEMO (no tuning needed, already on 87.5)");
}
{
  // The radio shows another channel than typed: stop before confirming
  const {run, sim, sent} = rig();
  sim.receive = ((orig) => function (pkt) {
    if (pkt[2] === 0x0C && pkt[3] === 0x05 && this.mode === "store") { this.buf += "5"; this.preset(2, 9); return; }
    orig.call(this, pkt);
  })(sim.receive);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(run.store({band: "SW", kHz: 11620, ch: 5}), /shows CH 9, not 5; not confirmed/);
  assert.ok(!sent.some((p) => p[2] === 0x0C && p[3] === 0x24));  // MEMO short never sent
  n++; console.log("✓ a wrong channel on the display stops the run before confirming");
}
{
  // The radio doesn't repeat a number that's already up (MEMO long proposes 1, user wants 1): still fine
  const {run, sim} = rig();
  sim.receive = ((orig) => function (pkt) {
    if (pkt[2] === 0x0C && pkt[3] === 0x01 && this.mode === "store") { this.buf += "1"; return; }
    orig.call(this, pkt);
  })(sim.receive);
  await new Promise((r) => setTimeout(r, 20));
  await run.store({band: "SW", kHz: 11620, ch: 1});
  assert.equal(sim.bank.get("SW:1"), 11620);
  n++; console.log("✓ a channel already shown (no repeat message) still stores");
}
{
  // recall: no reply at all is neither a frequency nor empty
  const {run, sim} = rig();
  sim.recall = function () { this.buf = ""; };
  await new Promise((r) => setTimeout(r, 20));
  deq(await run.recall("SW", 3), {kHz: null, empty: false});
  n++; console.log("✓ recall tells an empty channel apart from no reply");
}
{
  // Start fresh: wipe SW, keep FM; the check recalls the lowest stored SW channel
  const {run, sim, sent} = rig();
  await new Promise((r) => setTimeout(r, 20));
  for (const e of [{band: "SW", kHz: 5025, ch: 4}, {band: "SW", kHz: 6000, ch: 7}, {band: "FM", kHz: 101300, ch: 1}]) await run.store(e);
  await run.wipe("SW", 4);
  deq([...sim.bank.keys()], ["FM:1"]);
  assert.ok(sent.some((p) => T.hex(p) === "ab 02 0c 33 ec"));  // SCAN long
  assert.ok(!sent.some((p) => T.hex(p) === "ab 02 0c 1a d3"));  // no scan, so no stop
  n++; console.log("✓ wipe(\"SW\") sends 33, empties SW, keeps FM, confirms CH 4 is empty");
}
{
  // A radio that ignores 33: the check catches it
  const {run, sim} = rig();
  sim.receive = ((orig) => function (pkt) { if (pkt[2] === 0x0C && pkt[3] === 0x33) return; orig.call(this, pkt); })(sim.receive);
  await new Promise((r) => setTimeout(r, 20));
  await run.store({band: "SW", kHz: 9580, ch: 1});
  await assert.rejects(run.wipe("SW", 1), /CH 1 still holds 9580 kHz: the band wasn't wiped/);
  n++; console.log("✓ a wipe that didn't happen fails with \"still holds\"");
}
{
  // A radio that starts scanning after 33: the guard presses SCAN short (1A) to stop it
  const {run, sim, sent} = rig();
  let timer = null;
  sim.receive = ((orig) => function (pkt) {
    orig.call(this, pkt);
    if (pkt[2] !== 0x0C) return;
    if (pkt[3] === 0x33) timer = setInterval(() => { this.kHz += 5; this.sendFreq(); }, 40);
    if (pkt[3] === 0x1A) clearInterval(timer);
  })(sim.receive);
  await new Promise((r) => setTimeout(r, 20));
  await run.wipe("SW", 1);
  clearInterval(timer);
  assert.ok(sent.some((p) => T.hex(p) === "ab 02 0c 1a d3"));
  n++; console.log("✓ a scan that starts after the wipe is stopped with SCAN short");
}
{
  // The live failure, 2026-11-02: the radio works through keys ~400 ms each and loses a repeated key sent
  // before the previous one is handled ("433.275" became 43.275). Here: 40 ms per key, same rule
  const w = new T.Waiters(), dec = new T.Decoder(), queue = [];
  const sim = new T.RadioSim((pkt) => { for (const ev of dec.feed(pkt)) w.feed(ev); });
  sim.band = "UHF"; sim.kHz = 430450;
  const tick = setInterval(() => { const pkt = queue.shift(); if (pkt) sim.receive(pkt); }, 40);
  const link = {
    async send(pkt) {
      const last = queue[queue.length - 1];
      if (last && last[2] === 0x0C && pkt[2] === 0x0C && last[3] === pkt[3]) return;  // dropped
      queue.push(pkt);
    },
    press(k) { return this.send(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]])); },
    tune(band, raw = 0) { return this.send(T.frame(0x10, [T.BAND_CODES[band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24])); },
  };
  sim.sendFreq();
  await new Promise((r) => setTimeout(r, 20));
  const cfg = {...T.MEMO_CFG, stepMs: 2, timeoutMs: 1000, echoMs: 300};
  // The old way: all keys 150 ms → here 5 ms apart, no waiting: the second 3 is lost and the radio refuses 43.275
  for (const k of ["FREQ", "4", "3", "3", "POINT", "2", "7", "5", "FREQ"]) { await link.press(k); await new Promise((r) => setTimeout(r, 5)); }
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(T.toKHz(w.freq), 430450);  // still where it was
  // The new way: one key per echo
  const run = new T.MemoryRun(link, w, {cfg});
  await run.store({band: "UHF", kHz: 433275, ch: 2});
  assert.equal(sim.bank.get("UHF:2"), 433275);
  clearInterval(tick);
  n++; console.log("✓ a slow radio that drops repeated keys: blind typing fails, echo-paced typing stores 433.275");
}
{
  // An entry the radio refuses stops at once with "refused", not after a timeout
  const {w, link, sim} = rig();
  sim.band = "UHF"; sim.kHz = 430450; sim.sendFreq();
  await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now();
  await assert.rejects(T.typeEntry(link, w, "43.275", {...T.MEMO_CFG, timeoutMs: 2000}), /refused 43\.275 \(input error\)/);
  assert.ok(Date.now() - t0 < 1000);
  n++; console.log("✓ an input error (0F result 2) fails at once");
}
{
  // The live UHF and AIR formats read right
  const dec = new T.Decoder(), evs = [...dec.feed(T.frame(0x01, [0x05, ...[4304500 & 255, 4304500 >> 8 & 255, 4304500 >> 16 & 255, 0], 0, 0x13, 0])),
    ...dec.feed(T.frame(0x01, [0x03, ...[1181000 & 255, 1181000 >> 8 & 255, 1181000 >> 16 & 255, 0], 0, 0x13, 0]))];
  deq(evs.map((e) => [e.data.band, e.data.text, T.toKHz(e.data)]), [["UHF", "430.4500", 430450], ["AIR", "118.1000", 118100]]);
  n++; console.log("✓ live UHF (raw 4304500, dp 13) and AIR (raw 1181000, dp 13) read as 430.450 and 118.100 MHz");
}
{
  // The live failure, 2026-11-02 21:55: CH 11's two 1s went 150 ms apart and the radio showed CH 1.
  // Same slow radio as above (40 ms per key, drops a repeated key still queued)
  const w = new T.Waiters(), dec = new T.Decoder(), queue = [];
  const sim = new T.RadioSim((pkt) => { for (const ev of dec.feed(pkt)) w.feed(ev); });
  sim.band = "AIR"; sim.kHz = 129700;
  const tick = setInterval(() => { const pkt = queue.shift(); if (pkt) sim.receive(pkt); }, 40);
  const link = {
    async send(pkt) {
      const last = queue[queue.length - 1];
      if (last && last[2] === 0x0C && pkt[2] === 0x0C && last[3] === pkt[3]) return;
      queue.push(pkt);
    },
    press(k) { return this.send(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]])); },
    tune(band, raw = 0) { return this.send(T.frame(0x10, [T.BAND_CODES[band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24])); },
  };
  sim.sendFreq();
  await new Promise((r) => setTimeout(r, 20));
  const run = new T.MemoryRun(link, w, {cfg: {...T.MEMO_CFG, stepMs: 2, timeoutMs: 1000, echoMs: 300}});
  for (const ch of [11, 100, 111, 200]) await run.store({band: "AIR", kHz: 129700, ch});
  deq([...sim.bank.keys()].sort(), ["AIR:100", "AIR:11", "AIR:111", "AIR:200"]);
  // and recall paces its digits too
  deq(await run.recall("AIR", 111), {kHz: 129700, empty: false});
  clearInterval(tick);
  n++; console.log("✓ a slow radio that drops repeated digits: CH 11, 100, 111, 200 all store, and 111 recalls");
}
{
  // A digit the radio really loses (no echo ever) stops before confirming, naming where it got to
  const {run, sim, sent} = rig();
  sim.receive = ((orig) => function (pkt) {
    if (pkt[2] === 0x0C && pkt[3] === 0x01 && this.mode === "store" && this.buf === "1") return;  // 2nd "1" lost
    orig.call(this, pkt);
  })(sim.receive);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(run.store({band: "SW", kHz: 11620, ch: 11}), /shows CH 1, not 11; not confirmed/);
  assert.ok(!sent.some((p) => p[2] === 0x0C && p[3] === 0x24));
  n++; console.log("✓ a lost digit stops the run before confirming");
}
{
  // Store here: the radio proposes the highest channel in use + 1 (✓ live: 38, 40 → 41) and the app confirms it
  const {run, sim, sent} = rig();
  sim.band = "AIR"; sim.kHz = 127500; sim.bank.set("AIR:38", 118100); sim.bank.set("AIR:40", 119100); sim.bank.set("FM:90", 99900);
  sim.sendFreq();
  await new Promise((r) => setTimeout(r, 20));
  const before = sent.length;
  assert.equal(await run.storeNext("AIR"), 41);
  assert.equal(sim.bank.get("AIR:41"), 127500);
  assert.equal(sim.bank.has("AIR:39"), false);
  deq(sent.slice(before).map((p) => T.hex(p)), ["ab 02 0c 2c e5", "ab 02 0c 24 dd"]);  // MEMO long, MEMO: no digits typed
  assert.equal(await run.storeNext("AIR"), 42);
  n++; console.log("✓ storeNext: AIR 38 and 40 in use → stores on 41, then 42, with no digits typed");
}
{
  // CH 200 in use: the proposal (201 here) is refused and nothing is confirmed
  const {run, sim, sent} = rig();
  sim.bank.set("SW:200", 9580);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(run.storeNext("SW"), /proposes CH 201: SW has no channel after the last one in use \(max 200\)/);
  assert.ok(!sent.some((p) => p[2] === 0x0C && p[3] === 0x24));
  deq([...sim.bank.keys()], ["SW:200"]);
  n++; console.log("✓ storeNext refuses a proposal past 200 without confirming");
}
{
  // The caller's guard (this app's record says CH n holds something else): refused, nothing confirmed
  const {run, sim, sent} = rig();
  sim.bank.set("SW:4", 6000);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(run.storeNext("SW", (n) => n === 5 ? "CH 5 holds 7300 kHz per this app's record" : null), /CH 5 holds 7300/);
  assert.ok(!sent.some((p) => p[2] === 0x0C && p[3] === 0x24));
  assert.equal(sim.bank.has("SW:5"), false);
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(sim.mode, null);  // store mode closed by itself, like the radio
  n++; console.log("✓ storeNext's guard refuses a channel without confirming; store mode then times out");
}
{
  // Store on radio asks first: Store confirms the proposed channel; Cancel, or no answer in time, sends no confirm key
  const MEMO = (p) => p[2] === 0x0C && p[3] === 0x24;
  const a = rig();
  await new Promise((r) => setTimeout(r, 20));
  a.sim.bank.set("SW:4", 6000);
  let asked = null;
  assert.equal(await a.run.storeNext("SW", undefined, undefined, async (n) => { asked = n; return true; }), 5);
  assert.equal(asked, 5);
  assert.equal(a.sim.bank.has("SW:5"), true);

  const b = rig();
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(b.run.storeNext("SW", undefined, undefined, async () => false), T.CancelErr);
  assert.ok(!b.sent.some(MEMO));
  deq([...b.sim.bank.keys()], []);
  assert.equal(b.sim.mode, null);  // released only once store mode has closed

  const c = rig();
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(c.run.storeNext("SW", undefined, undefined, async () => { await new Promise((r) => setTimeout(r, 400)); return true; }), /closed store mode first/);
  assert.ok(!c.sent.some(MEMO));
  deq([...c.sim.bank.keys()], []);
  n++; console.log("✓ storeNext asks: Store confirms; Cancel or an answer after store mode closed sends no confirm key");
}
{
  // Backup: the record as text, and back through the parser
  const record = {"FM:1": {kHz: 101300, name: "Radio Bio Bio"}, "FM:3": {kHz: 99900, name: ""}, "AIR:12": {kHz: 127500, name: "Torre Santiago"},
    "UHF:41": {kHz: 433275, name: "Canal #1 repetidor"}, "SW:2": {kHz: 9580, name: "China Radio Int."},
    "bogus": {kHz: 1}, "WB:1": {kHz: 162550}, "SW:201": {kHz: 9580}, "SW:0": {kHz: 9580}, "FM:9": {kHz: 0}};
  const text = T.backupText(record, "2026-11-02 21:40");
  const lines = text.split("\n");
  assert.equal(lines[0], "# RF919 memories · exported 2026-11-02 21:40 · 5 channels: FM 2, SW 1, AIR 1, UHF 1");
  const {entries, errors} = T.parseMemList(text);
  assert.equal(errors.length, 0);
  deq(entries.map((e) => [e.band, e.ch, e.kHz, e.name]), T.recordItems(record).map((e) => [e.band, e.ch, e.kHz, e.name]));
  deq(entries.map((e) => `${e.band}:${e.ch}`), ["FM:1", "FM:3", "SW:2", "AIR:12", "UHF:41"]);  // malformed keys skipped
  assert.equal(entries.find((e) => e.band === "UHF").name, "Canal #1 repetidor");  // "#" inside a name survives
  n++; console.log("✓ backup text round-trips (names, an empty name, \"#\" in a name), malformed record keys skipped");
}
{
  // Importing 201 SW lines: the 201st is refused
  const text = Array.from({length: 201}, (_, i) => `SW ${3000 + i * 5}`).join("\n");
  const {entries, errors} = T.parseMemList(text);
  assert.equal(errors.length, 0);
  const res = T.addToList([], entries);
  assert.equal(res.list.length, 200);
  assert.match(res.errors[0].msg, /SW is full \(200\/200\)/);
  n++; console.log("✓ an import of 201 SW lines refuses the 201st");
}
{
  const has = (pos, codes, not = []) => { const t = T.targetsAt(pos); for (const c of codes) assert.ok(t.has(c), `${c} missing for ${JSON.stringify(pos)}: ${[...t]}`); for (const c of not) assert.ok(!t.has(c), `${c} unexpected`); return t; };
  const scl = has({lat: -33.45, lon: -70.66}, ["SAm", "LAm", "Am", "CHL"], ["NAm", "Eu", "ARG", "CAm"]);
  assert.equal(T.targetsName(scl), "South America");
  has({lat: -32.89, lon: -68.84}, ["SAm", "ARG"], ["CHL"]);            // Mendoza
  has({lat: -23.65, lon: -70.4}, ["CHL"], ["ARG", "BOL"]);              // Antofagasta
  has({lat: 40.42, lon: -3.7}, ["Eu", "WEu", "SEu"], ["SAm", "Am"]);    // Madrid
  has({lat: 35.68, lon: 139.69}, ["FE", "As"], ["SEA"]);                // Tokyo
  has({lat: 38.9, lon: -77.04}, ["ENA", "NAm", "Am", "USA"], ["LAm"]);  // Washington
  assert.equal(T.targetsAt(null).size, 0);
  assert.equal(T.aimedAt({target: "SAm"}, scl), true);
  assert.equal(T.aimedAt({target: "FE"}, scl), false);
  assert.equal(T.aimedAt({target: "CHL"}, scl), true);
  assert.equal(T.aimedAt({target: "Eu,SAm"}, scl), true);
  assert.equal(T.aimedAt({}, scl), false);
  n++; console.log("✓ EiBi targets: Santiago = SAm/LAm/Am/CHL (South America); Mendoza ARG not CHL; Madrid, Tokyo, Washington");
}
{
  // Edit as text on one band: lines without a band take it; a named band is kept (and refused by the UI)
  const {entries, errors} = T.parseMemList("12 127.5\n1 FM 99.9\n5 146.73 Repetidor", "AIR");
  assert.equal(errors.length, 0);
  deq(entries.map((e) => [e.ch, e.band, e.kHz, e.named, e.name]), [[12, "AIR", 127500, false, ""], [1, "FM", 99900, true, ""], [5, "AIR", 146730, false, "Repetidor"]]);
  deq(T.parseMemList("146.73").entries.map((e) => e.band), ["VHF"]);  // no default: the frequency's band, as before
  n++; console.log("✓ parseMemList with a default band (lines without a band take it; named bands are kept)");
}
ok("Explore's dial: stepKnown (ends, exact hit, off a known kHz, n > 1 clamps), stripTicks", () => {
  const f = [5900, 5905, 5915, 6000, 9400, 9410];
  assert.equal(T.stepKnown(f, 5905, 1), 5915);
  assert.equal(T.stepKnown(f, 5905, -1), 5900);
  assert.equal(T.stepKnown(f, 5910, 1), 5915);   // between two known: the next one up
  assert.equal(T.stepKnown(f, 5910, -1), 5905);
  assert.equal(T.stepKnown(f, 9410, 1), null);   // the ends
  assert.equal(T.stepKnown(f, 5900, -1), null);
  assert.equal(T.stepKnown(f, 5900, 1, 3), 6000);
  assert.equal(T.stepKnown(f, 5900, 1, 10), 9410); // fewer than n left: the last one
  assert.equal(T.stepKnown(f, 9410, -1, 10), 5900);
  assert.equal(T.stepKnown([], 9580, 1), null);
  deq(T.stripTicks(f, 5900, 6000), [5900, 5905, 5915, 6000]);
});
ok("stripRange: a meter band, the gap between two, SW's ends, another band; bandChips", () => {
  deq(T.stripRange(9580), {label: "31m", lo: 9400, hi: 9900});
  deq(T.stripRange(7000), {label: "SW", lo: 6201, hi: 7199});   // between 49 m and 41 m
  deq(T.stripRange(2000), {label: "SW", lo: 1711, hi: 2299});   // below 120 m
  deq(T.stripRange(28000), {label: "SW", lo: 26101, hi: 29999});
  deq(T.stripRange(101300), {label: "FM", lo: 64000, hi: 108000});
  assert.equal(T.stripRange(100), null);
  deq(T.bandChips([720, 9580, 9600, 101300, 146730]), [{label: "AM", n: 1, k: 720}, {label: "31m", n: 2, k: 9580},
    {label: "FM", n: 1, k: 101300}, {label: "VHF", n: 1, k: 146730}]);
});
ok("bearing and compass: Santiago → Madrid; due north/east; 0/360 wrap", () => {
  const scl = {lat: -33.45, lon: -70.66};
  assert.ok(Math.abs(T.bearingDeg(scl, {lat: 40.42, lon: -3.7}) - 47) < 3);
  assert.ok(Math.abs(T.bearingDeg({lat: 0, lon: 0}, {lat: 10, lon: 0})) < 1e-9);
  assert.ok(Math.abs(T.bearingDeg({lat: 0, lon: 0}, {lat: 0, lon: 10}) - 90) < 1e-9);
  assert.equal(T.compass(0), "N"); assert.equal(T.compass(359), "N"); assert.equal(T.compass(360), "N");
  assert.equal(T.compass(22.5), "NNE"); assert.equal(T.compass(47), "NE"); assert.equal(T.compass(-90), "W");
  assert.match(T.kmBearing(scl, {lat: 40.42, lon: -3.7}), /^10\D?\d{3} km · NE 4\d°$/);
});
ok("swOnAir: on air first per frequency, else the next within the window; aimed filter; order kept", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0);  // Wed 12:00 UTC
  const e = (station, s, t, target = "SAm") => ({station, startUTC: s, endUTC: t, days: {t: "d"}, target});
  const pairs = [[9400, {shortwave: [e("Later", "1230", "1300"), e("Now", "1100", "1300", "Eu")], stations: []}],
    [9410, {shortwave: [e("Soon", "1220", "1300")], stations: []}], [9420, {shortwave: [e("Tonight", "2200", "2300")], stations: []}],
    [9430, null], [9440, {shortwave: [], stations: []}]];
  deq(T.swOnAir(pairs, {now}).map((r) => [r.k, r.e.station, r.air.on]), [[9400, "Now", true]]);
  deq(T.swOnAir(pairs, {now, win: 30}).map((r) => [r.k, r.e.station]), [[9400, "Now"], [9410, "Soon"]]);
  const sam = T.targetsAt({lat: -33.45, lon: -70.66});
  deq(T.swOnAir(pairs, {now, win: 30, targets: sam}).map((r) => [r.k, r.e.station, r.air.startsIn]), [[9400, "Later", 30], [9410, "Soon", 20]]);
});
ok("nearestStations: kind, radius, repeaters heard on their output, the nearest per kHz, nearest first", () => {
  const pos = {lat: -33.45, lon: -70.66};
  const st = (nombre, lat, lon, more = {}) => ({nombre, lat, lon, category: "broadcast", ...more});
  const pairs = [[101300, {stations: [st("Far", -36.8, -73.05), st("Near", -33.44, -70.65)]}],
    [146130, {stations: [st("Rpt", -33.4, -70.6, {category: "amateur", rxKHz: 146730, txKHz: 146130})]}],
    [99900, {stations: [st("Mid", -33.0, -71.6)]}], [88100, {stations: [st("Nowhere", null, null)]}], [90000, null]];
  deq(T.nearestStations(pairs, {band: "FM", pos}).map((r) => [r.k, r.s.nombre]), [[101300, "Near"], [99900, "Mid"], [88100, "Nowhere"]]);
  deq(T.nearestStations(pairs, {band: "FM", pos, radius: 50}).map((r) => r.s.nombre), ["Near"]);
  deq(T.nearestStations(pairs, {band: "VHF", pos}).map((r) => [r.k, r.s.nombre]), [[146730, "Rpt"]]);
  deq(T.nearestStations(pairs, {band: "FM", kind: "amateur", pos}), []);
  deq(T.nearestStations(pairs, {band: "FM"}).map((r) => r.k), [88100, 99900, 101300]);  // no position: by kHz
});

// ---- Tuner: Explore's picks tune the radio, one tune at a time, the latest pick wins ----
{
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (runMs = 30, fail = () => false) => {
    const runs = [], states = [];
    const t = new Tuner(async (k) => { runs.push(k); await wait(runMs); if (fail(k)) throw new Error("no echo"); return {k}; },
      {settleMs: 20, onState: (s) => states.push([s.k, s.state])});
    return {t, runs, states};
  };
  let a = mk();
  for (const k of [9500, 9510, 9520, 9530, 9540]) a.t.request(k);
  await wait(80);
  deq(a.runs, [9540]);
  deq(a.states.filter(([, s]) => s !== "pending"), [[9540, "tuning"], [9540, "done"]]);
  ok("Tuner: a swipe through 5 frequencies tunes once, to the last", () => {});
  a = mk(60);
  a.t.request(9500, {now: true});
  await wait(10);
  a.t.request(9600);
  await wait(30);  // 9600 has settled, 9500 is still tuning
  assert.equal(a.t.busy, true);
  deq(a.runs, [9500]);
  await wait(120);
  deq(a.runs, [9500, 9600]);
  ok("Tuner: a pick during a tune runs after it, never alongside", () => {});
  a = mk(10, (k) => k === 9500);
  a.t.request(9500, {now: true});
  await wait(30);
  a.t.request(9600, {now: true});
  await wait(30);
  deq(a.states.filter(([, s]) => s === "failed" || s === "done"), [[9500, "failed"], [9600, "done"]]);
  ok("Tuner: a failed tune is reported and the next pick still tunes", () => {});
  a = mk();
  a.t.request(9500);
  a.t.cancel();
  await wait(60);
  deq(a.runs, []);
  ok("Tuner: cancel drops the pick still settling", () => {});
  a = mk(30);
  await a.t.idle();  // nothing under way: resolves at once
  a.t.request(9500, {now: true});
  await wait(10);
  assert.equal(a.t.busy, true);
  await a.t.idle();
  assert.equal(a.t.busy, false);
  deq(a.states.at(-1), [9500, "done"]);
  ok("Tuner: idle waits for the tune under way", () => {});
}

// ---- Logbook: a frequency held 30 s is logged, with its best signal ----
ok("Logbook: nothing before 30 s, then one entry that grows; peaks kept; a sweep never logs", () => {
  const ev = [], lb = new Logbook([], {onChange: (type, e) => ev.push([type, e.k])});
  const t0 = Date.UTC(2026, 10, 4, 14, 30);
  for (let i = 0; i < 10; i++) lb.feed(9500 + i * 5, "SW", t0 + i * 1000);  // a scan: 1 s each
  lb.feed(9580, "SW", t0 + 10000, {mode: "AM"});
  lb.signal({rssi: 20, snr: 5}, t0 + 15000);
  lb.tick(t0 + 39000);
  assert.equal(lb.entries.length, 0);
  lb.signal({rssi: 32, snr: 3}, t0 + 40000);
  assert.equal(lb.entries.length, 1);
  deq(ev, [["open", 9580]]);
  lb.signal({rssi: 25, snr: 12}, t0 + 70000);
  lb.tick(t0 + 90000);
  const e = lb.entries[0];
  deq([e.k, e.band, e.mode, e.start, e.end, e.rssi, e.snr], [9580, "SW", "AM", t0 + 10000, t0 + 90000, 32, 12]);
});
ok("Logbook: back within 10 min carries on the same entry; later, a new one; Demo entries apart and dropped", () => {
  const lb = new Logbook([]), t0 = 1e12;
  lb.feed(9580, "SW", t0); lb.tick(t0 + 31000);
  lb.feed(11620, "SW", t0 + 32000);
  lb.feed(9580, "SW", t0 + 5 * 60000);
  assert.equal(lb.entries.length, 1);
  assert.equal(lb.entries[0].end, t0 + 5 * 60000);
  lb.feed(null, null, t0 + 6 * 60000);
  lb.feed(9580, "SW", t0 + 30 * 60000); lb.tick(t0 + 31 * 60000);
  assert.equal(lb.entries.length, 2);
  lb.feed(9580, "SW", t0 + 32 * 60000, {demo: true}); lb.tick(t0 + 33 * 60000);
  assert.equal(lb.entries.length, 3);
  assert.equal(lb.entries[2].demo, true);
  deq(lb.heard(9580).n, 3);
  assert.equal(lb.dropDemo(), 1);
  deq(lb.heard(9580).n, 2);
  assert.equal(lb.entries.length, 2);
  const r = lb.remove(lb.entries[0].id);
  assert.equal(lb.entries.length, 1);
  lb.restore(r);
  assert.equal(lb.entries[0].id, r.e.id);
});
ok("Signal: keeps the last 60 s; best and last", () => {
  const s = new Signal();
  s.add(10, 1, 0); s.add(30, null, 30000); s.add(20, 4, 70000);
  deq(s.pts.map((p) => p.t), [30000, 70000]);
  assert.equal(s.best("rssi"), 30); assert.equal(s.last("snr"), 4); assert.equal(s.best("snr"), 4);
});
ok("export: CSV quotes what needs it; ADIF counts its fields, drops accents, a band only for amateur frequencies", () => {
  const t = Date.UTC(2026, 10, 4, 14, 30);
  const es = [{k: 9580, band: "SW", mode: "AM", start: t, end: t + 22 * 60000, rssi: 32, snr: 12, station: "IBRA Radio, Sweden", star: true},
    {k: 7150, band: "SW", mode: "LSB", start: t, end: t + 60000, rssi: null, snr: null, station: "Radio Bío-Bío", star: false}];
  assert.equal(toCsv(es), "date_utc,start_utc,end_utc,khz,band,mode,station,rssi,snr,starred\n" +
    "20261104,1430,1452,9580,SW,AM,\"IBRA Radio, Sweden\",32,12,yes\n20261104,1430,1431,7150,SW,LSB,Radio Bío-Bío,,,\n");
  const lines = toAdif(es).split("\n");
  assert.equal(lines[1], "<ADIF_VER:5>3.1.4 <PROGRAMID:15>RF919 Companion <PROGRAMVERSION:1>1 <EOH>");
  assert.equal(lines[2], "<CALL:18>IBRA Radio, Sweden <QSO_DATE:8>20261104 <TIME_ON:4>1430 <TIME_OFF:4>1452 <FREQ:5>9.580 " +
    "<MODE:2>AM <SWL:1>Y <COMMENT:14>RSSI 32 SNR 12 <EOR>");
  assert.equal(lines[3], "<CALL:13>Radio Bio-Bio <QSO_DATE:8>20261104 <TIME_ON:4>1430 <TIME_OFF:4>1431 <FREQ:5>7.150 <BAND:3>40m " +
    "<MODE:3>SSB <SUBMODE:3>LSB <SWL:1>Y <EOR>");
  assert.equal(adifBand(146730), "2m"); assert.equal(adifBand(101300), "");
});

// ---- NameIndex: station names → frequencies, for Explore's search ----
ok("NameIndex: accents and case don't matter; words in any order; whole words, then starts, then inside", () => {
  const ix = new NameIndex();
  ix.add(9580, {shortwave: [{station: "Radio Romania Int.", itu: "ROU"}, {station: "IBRA Radio", itu: "S"}], stations: []});
  ix.add(11620, {shortwave: [{station: "Radio Romania Int.", itu: "ROU"}], stations: []});
  ix.add(101300, {shortwave: [], stations: [{nombre: "Radio Bío-Bío", signal: "CB-101", category: "broadcast"}]});
  ix.add(146730, {shortwave: [], stations: [{nombre: "", signal: "CE3RPT", category: "amateur"}]});
  ix.add(7777, null);
  assert.equal(norm("Radio Bío-Bío"), "radio bio bio");
  deq(ix.search("bio bio").map((h) => [h.name, h.ks, h.flag]), [["Radio Bío-Bío", [101300], "cl"]]);
  deq(ix.search("romania radio")[0].ks, [9580, 11620]);
  deq(ix.search("radio").map((h) => h.name), ["IBRA Radio", "Radio Bío-Bío", "Radio Romania Int."]);
  deq(ix.search("rom").map((h) => h.name), ["Radio Romania Int."]);
  deq(ix.search("e3rp").map((h) => h.name), ["CE3RPT"]);  // inside a word
  deq(ix.search("radio xyz"), []);
  assert.equal(ix.seen.size, 5);
  const back = NameIndex.fromJSON(JSON.parse(JSON.stringify(ix)));
  deq(back.search("radio").map((h) => [h.name, h.ks]), ix.search("radio").map((h) => [h.name, h.ks]));
  assert.equal(back.seen.has(7777), true);
});
// ---- No radio: the virtual radio (virtual.js), through the real decoder ----
ok("Logbook: No radio's entries are their own (never joined with a radio's), tagged, and kept when the replay's go", () => {
  const lb = new Logbook([], {dwellMs: 1000}), t0 = Date.now();
  lb.feed(9580, "SW", t0); lb.tick(t0 + 2000);
  lb.feed(9580, "SW", t0 + 3000, {virtual: true}); lb.tick(t0 + 5000);
  lb.feed(9580, "SW", t0 + 6000, {demo: true}); lb.tick(t0 + 8000);
  deq(lb.entries.map((e) => [!!e.virtual, !!e.demo]), [[false, false], [true, false], [false, true]]);
  lb.feed(9580, "SW", t0 + 9000, {virtual: true}); lb.tick(t0 + 9500);
  assert.equal(lb.entries.length, 3);  // back within joinMs: the same No radio entry carries on
  assert.equal(lb.dropDemo(), 1);
  assert.equal(lb.entries.filter((e) => e.virtual).length, 1);
});
{
  const V = await import("../docs/js/virtual.js");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (hooks = {}, saved = null) => {
    const dec = new T.Decoder(), evs = [];
    const r = new V.VirtualRadio((pkt) => { for (const ev of dec.feed(pkt)) evs.push(ev); }, hooks, saved);
    const key = (k) => r.receive(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]]));
    const last = (kind, name) => evs.findLast((e) => e.kind === kind && (!name || e.data.name === name));
    return {r, evs, key, last, field: (name) => last("field", name)?.data.value};
  };

  ok("virtual radio: says hello like the RF919 (mode, bands, labels, settings, frequency)", () => {
    const {r, last, field} = mk();
    r.hello(); r.stop();
    assert.equal(last("mode").data.mode, "radio");
    assert.ok(last("bands").data.bands.includes("SW") && last("bands").data.bands.includes("FM"));
    assert.ok(!last("bands").data.bands.includes("WB"));
    assert.equal(field("demod_label"), "Demodulation");
    assert.equal(field("demod"), "AM");
    assert.equal(field("volume"), "8");
    assert.equal(last("button_label").data.value, "FUNC");
    assert.equal(T.toKHz(last("freq").data), 9580);
    assert.ok(field("rssi") != null && field("snr") != null);
  });

  ok("virtual radio: ◀ ▶ step by the band's step and wrap; STEP changes it; off the grid snaps onto it", () => {
    const {r, key, field} = mk();
    key("UP"); assert.equal(r.kHz, 9585);
    key("DOWN"); key("DOWN"); assert.equal(r.kHz, 9575);
    r.kHz = 29995; key("UP"); assert.equal(r.kHz, 1711);
    r.kHz = 9580; key("STEP"); key("UP"); assert.equal(r.kHz, 9581);
    assert.match(field("field11"), /STEP:1K/);
    r.band = "AM"; r.kHz = 999; key("STEP"); key("UP"); assert.equal(r.kHz, 1000);  // 9 → 10 kHz
    key("DOWN"); assert.equal(r.kHz, 990);
  });

  ok("virtual radio: BAND goes through its bands and each keeps its frequency; a tune goes back", () => {
    const {r, key, last} = mk();
    key("BAND"); assert.equal(r.band, "LW"); assert.equal(r.kHz, 198);
    key("UP"); key("BAND"); assert.equal(r.band, "AIR");
    r.receive(T.frame(0x10, [T.BAND_CODES.LW, 0, 0, 0, 0])); assert.equal(r.band, "LW"); assert.equal(r.kHz, 207);
    r.receive(T.frame(0x10, [T.BAND_CODES.SW, 0, 0, 0, 0])); assert.equal(r.kHz, 9580);
    r.receive(T.frame(0x10, [T.BAND_CODES.FM, 0, 0, 0, 0])); assert.equal(r.kHz, 100100);  // a band not visited yet
    r.receive(T.frame(0x10, [T.BAND_CODES.WB, 0, 0, 0, 0])); assert.equal(r.band, "FM");    // no WB here
    assert.equal(last("field", "demod").data.value, "WFM");
  });

  ok("virtual radio: volume stays within 0–30; squelch and demodulation cycle", () => {
    const {r, key, field} = mk();
    r.vol = 29; key("VOL+"); key("VOL+"); assert.equal(r.vol, 30);
    key(0x43); assert.equal(r.vol, 25);  // VOL- long: 5 down
    assert.equal(field("volume"), "25");
    key("SQ"); assert.equal(field("field10"), "1");
    key("DEMOD"); assert.equal(field("demod"), "SSB");
    key("BANDWIDTH"); assert.equal(field("bw"), "3.0K");
  });

  ok("virtual radio: standby ignores everything but POWER and stops the signal", () => {
    const {r, key, evs, last} = mk({signal: () => 1});
    key("POWER"); assert.equal(last("mode").data.mode, "standby");
    const n = evs.length;
    key("UP"); r.sendSignal(); assert.equal(evs.length, n); assert.equal(r.kHz, 9580);
    key("POWER"); assert.equal(last("mode").data.mode, "radio");
  });

  ok("virtual radio: the signal follows hooks.signal; squelch closes on a faint one", () => {
    const strong = mk({signal: () => 1}); strong.r.sendSignal();
    assert.ok(+strong.field("rssi") >= 55 && +strong.field("snr") >= 25);
    const faint = mk({signal: () => 0}); faint.r.sendSignal();
    assert.ok(+faint.field("rssi") <= 10);
    faint.r.sq = 5; faint.r.sendSignal(); assert.equal(faint.field("snr"), "0");
  });

  ok("virtual radio: memories store, recall, step in channel mode, and survive a save", () => {
    const {r, key} = mk();
    const store = (k, ch) => { r.kHz = k; key("MEMO_LONG"); for (const d of String(ch)) key(d); key("MEMO"); };
    store(9580, 1); store(11620, 2); store(15140, 5);
    clearTimeout(r.storeTimer);
    deq([...r.bank], [["SW:1", 9580], ["SW:2", 11620], ["SW:5", 15140]]);
    key("MEMO"); key("2"); key("FREQ"); assert.equal(r.kHz, 11620);
    key("UP"); assert.equal(r.kHz, 15140);
    key("UP"); assert.equal(r.kHz, 9580);  // wraps
    key("DOWN"); assert.equal(r.kHz, 15140);
    key("MEMO");  // leave channel mode
    r.vol = 12;
    const saved = JSON.parse(JSON.stringify(r));
    const b = mk({}, saved).r;
    deq([...b.bank], [...r.bank]);
    assert.equal(b.kHz, 15140); assert.equal(b.vol, 12);
    const bad = mk({}, {band: "XX", kHz: -1, bank: [["SW:999", 9580], ["SW:3", 99]], vol: 99}).r;
    assert.equal(bad.band, "SW"); assert.equal(bad.bank.size, 0); assert.equal(bad.vol, 8);
  });

  ok("virtual radio: the store sequence (MemoryRun) works against it", () => {});
  {
    const w = new T.Waiters(), dec = new T.Decoder();
    const r = new V.VirtualRadio((pkt) => { for (const ev of dec.feed(pkt)) w.feed(ev); });
    r.storeTimeoutMs = 300;
    const link = {
      async send(pkt) { setTimeout(() => r.receive(pkt), 5); },
      press(k) { return this.send(T.frame(0x0C, [typeof k === "number" ? k : T.KEYS[k]])); },
      tune(band, raw = 0) { return this.send(T.frame(0x10, [T.BAND_CODES[band], raw & 255, raw >> 8 & 255, raw >> 16 & 255, raw >>> 24])); },
      async typeFreq(text) { for (const k of ["FREQ", ...[...text].map((c) => c === "." ? "POINT" : c), "FREQ"]) { await this.press(k); await wait(2); } },
    };
    r.sendFreq(); await wait(20);
    const run = new T.MemoryRun(link, w, {cfg: {...T.MEMO_CFG, stepMs: 2, pauseMs: 5, timeoutMs: 300, echoMs: 150}});
    for (const e of [{band: "SW", ch: 3, kHz: 6000}, {band: "FM", ch: 1, kHz: 101300}]) await run.store(e);
    assert.equal(r.bank.get("SW:3"), 6000); assert.equal(r.bank.get("FM:1"), 101300);
    deq(await run.recall("SW", 3), {kHz: 6000, empty: false});
    r.stop();
  }

  {
    const {r, key} = mk({seek: (band, k, dir) => dir > 0 ? 9650 : 9500});
    key("UP_LONG"); await wait(V.SEEK_FRAME_MS * 5 + 40); assert.equal(r.kHz, 9650);
    key("DOWN_LONG"); await wait(V.SEEK_FRAME_MS * 5 + 40); assert.equal(r.kHz, 9500);
    const plain = mk().r;
    plain.receive(T.frame(0x0C, [T.KEYS.UP_LONG])); await wait(V.SEEK_FRAME_MS * 5 + 40); assert.equal(plain.kHz, 9630);  // 10 steps
    key("PLAY"); assert.ok(r.scanTimer);
    key("PLAY"); assert.equal(r.scanTimer, 0);  // SCAN again stops it
    key("PLAY"); key("UP"); assert.equal(r.scanTimer, 0);  // so does any key
    r.stop(); plain.stop();
    ok("virtual radio: hold ◀ ▶ seeks to the next station (else 10 steps); SCAN starts and any key stops it", () => {});
  }
}
{
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  for (const band of Object.values(T.BANDS)) {
    assert.ok(T.BAND_ICON[band], `no icon for ${band}`);
    assert.ok(html.includes(`<symbol id="${T.bandIconId(band)}"`), `no #${T.bandIconId(band)} in index.html`);
  }
  assert.equal(T.bandIconId("NOPE"), "i-b-other");
  ok("every band has its symbol, and the sprite has every symbol", () => {});
}
// ---- reception estimate ----
{
  const P = propagation, HOUR = 3600000;
  const RX = {lat: -33.45, lon: -70.67}, NEAR = {lat: -3.1, lon: -60}, FAR = {lat: 35.83, lon: 126.83}, POLAR = {lat: 64, lon: -150};
  const LISBON = {lat: 38.7, lon: -9.1}, NY = {lat: 40.7, lon: -74};
  const DAY0 = Date.UTC(2026, 10, 8), wx = {sfi: 127, kp: 2, r: 0};
  const at = (h) => DAY0 + h * HOUR;
  const est = (kHz, h, o = {}) => P.estimate({kHz, rx: RX, tx: NEAR, t: at(h), wx, aimed: true, ...o});
  const close = (a, b, d, what) => assert.ok(Math.abs(a - b) <= d, `${what}: ${a} is not within ${d} of ${b}`);

  ok("reception: the sun's height at known times and places", () => {
    close(P.cosZenith({lat: 0, lon: 0}, Date.UTC(2026, 2, 20, 12)), 1, .01, "equinox noon on the equator");
    close(P.cosZenith({lat: 0, lon: 0}, Date.UTC(2026, 2, 20, 0)), -1, .01, "equinox midnight");
    close(P.subsolar(Date.UTC(2026, 5, 21, 12)).lat, 23.44, .1, "June solstice");
    close(P.subsolar(Date.UTC(2026, 11, 21, 12)).lat, -23.44, .1, "December solstice");
    assert.ok(P.cosZenith(RX, at(16)) > .5, "Santiago mid-afternoon: sun high");
    assert.ok(P.cosZenith(RX, at(4)) < 0, "Santiago 01:00 local: dark");
  });
  ok("reception: a path's midpoint lies on the great circle", () => {
    const m = P.pathPoint({lat: 0, lon: 0}, {lat: 0, lon: 90}, .5);
    close(m.lat, 0, .01, "lat"); close(m.lon, 45, .01, "lon");
    deq(P.pathPoint(RX, RX, .5), RX);
    close(P.geomagLat({lat: 80.7, lon: -72.7}), 90, .01, "the geomagnetic pole");
  });
  ok("reception: low frequencies open at night, high ones by day", () => {
    assert.equal(est(6000, 16).tier, "unlikely");   // absorbed at midday
    assert.equal(est(6000, 4).tier, "likely");
    assert.equal(est(15400, 16).tier, "likely");
    assert.equal(est(15400, 4).tier, "unlikely");   // above the night's MUF
    assert.equal(est(21500, 16).tier, "likely");    // 3,700 km at midday: the measured F2 layer carries 13 m
    assert.equal(est(27000, 16, {wx: {...wx, sfi: 75}}).tier, "unlikely");   // a quiet sun closes it
    assert.ok(est(6000, 16).absorption > est(15400, 16).absorption);
    assert.equal(est(6000, 4).absorption, 0);
    assert.ok(est(6000, 16).muf > est(6000, 4).muf);
  });
  ok("reception: distance and aim count; the far side of the world stays hard", () => {
    const far = {tx: FAR, aimed: false};
    assert.equal(est(9580, 4, far).tier, "unlikely");
    assert.equal(est(9580, 4, far).hops, 6);
    assert.ok(est(6000, 4, {aimed: true}).score > est(6000, 4, {aimed: null}).score);
    assert.ok(est(6000, 4, {aimed: null}).score > est(6000, 4, {aimed: false}).score);
    assert.ok(est(6000, 4, {aimed: false}).reasons.some((r) => /elsewhere/.test(r)));
    const local = est(6000, 16, {tx: {lat: RX.lat + .2, lon: RX.lon}});
    assert.equal(local.tier, "likely");
    assert.match(local.reasons[0], /ground wave/);
  });
  ok("reception: storms hurt high-latitude paths and blackouts sunlit ones, only near the present", () => {
    const polar = {rx: LISBON, tx: POLAR, aimed: null}, storm = {...wx, kp: 7};
    assert.ok(est(9580, 4, {...polar, wx: storm}).score < est(9580, 4, polar).score);
    assert.ok(est(6000, 4, {wx: storm}).score === est(6000, 4).score, "a low-latitude path is left alone");
    assert.ok(est(9580, 4, {...polar, wx: storm, now: at(16)}).score === est(9580, 4, polar).score, "hours away");
    const r3 = {...wx, r: 3};
    assert.ok(est(15400, 16, {wx: r3}).score < est(15400, 16).score);
    assert.ok(est(15400, 16, {wx: r3}).reasons.some((r) => /R3/.test(r)));
    assert.equal(est(6000, 4, {wx: r3}).score, est(6000, 4).score, "a dark path is out of a blackout's reach");
  });
  ok("reception: medium wave is ground wave by day, sky wave at night", () => {
    const am = (km, h) => P.estimate({kHz: 1000, rx: RX, tx: {lat: RX.lat - km / 111.2, lon: RX.lon}, t: at(h), wx});
    assert.equal(am(100, 16).tier, "likely");
    assert.equal(am(100, 4).tier, "likely");
    assert.equal(am(300, 16).tier, "possible");
    assert.equal(am(1000, 16).tier, "unlikely");
    assert.equal(am(600, 4).tier, "likely");
    assert.equal(am(2000, 4).tier, "possible");
    assert.equal(am(5000, 4).tier, "unlikely");
    assert.equal(am(1000, 16).muf, null);
  });
  ok("reception: no estimate without the inputs, or above 30 MHz", () => {
    const go = (o) => P.estimate({kHz: 9580, rx: RX, tx: NEAR, t: at(4), wx, ...o});
    assert.ok(go({}));
    for (const o of [{rx: null}, {tx: null}, {tx: {lat: null, lon: null}}, {tx: {name: "Somewhere"}}, {wx: null}, {wx: {sfi: null}}, {kHz: 30000}, {kHz: 101300}, {kHz: 0}]) assert.equal(go(o), null, JSON.stringify(o));
  });
  ok("reception: the open range follows the sun; a window is cut by the hour and merged", () => {
    const noon = P.bestRange(RX, wx, at(16)), night = P.bestRange(RX, wx, at(4));
    assert.ok(noon.lo > night.lo && noon.hi > night.hi, JSON.stringify({noon, night}));
    assert.equal(night.lo, 3);
    deq(P.windowTiers(90, 270, (m) => m < 180 ? "likely" : "possible"), [{s: 90, t: 180, tier: "likely"}, {s: 180, t: 270, tier: "possible"}]);
    deq(P.windowTiers(0, 120, () => null), [{s: 0, t: 120, tier: null}]);
    deq(P.windowTiers(30, 30, () => "likely"), []);
  });
  ok("suggestions: best odds first whatever the band, one frequency per station, nothing unlikely or about to end", () => {
    const row = (k, key, score, left = 60, tier = "likely", aimed = false) => ({k, key, left, aimed, est: score == null ? null : {score, tier}});
    const ks = (rows, o) => P.rankSuggestions(rows, o).map((r) => r.k);
    deq(ks([row(15400, "a", 50, 60, "possible"), row(6195, "b", 90), row(1000, "c", 75, Infinity)], {ranked: true}), [6195, 1000, 15400]);
    deq(ks([row(9580, "a", 80, 30), row(9600, "b", 80, 90), row(9500, "c", 80, 90)], {ranked: true}), [9500, 9600, 9580]);
    deq(ks([row(9580, "a", 80), row(11620, "a", 95)], {ranked: true}), [11620]);
    deq(ks([row(9580, "a", 30, 60, "unlikely"), row(9600, "b", 80, 9), row(9700, "c", null), row(9800, "d", 80, 10)], {ranked: true}), [9800]);
    deq(ks([1, 2, 3, 4].map((i) => row(9000 + i, `s${i}`, 80)), {ranked: true, max: 2}), [9001, 9002]);
    deq(ks([row(9580, "a", null, 300), row(9600, "b", null, 40, "", true), row(9700, "c", null, 5, "", true)], {ranked: false}), [9600, 9580]);
  });
  ok("suggestions: the frequencies to read are shared among the ranges and spread along each", () => {
    const f = [600, 610, 620, 9500, 9510, 9520, 9530, 11600, 11610, 20000];
    deq(T.sampleFreqs(f, [[500, 700], [9400, 9900]], 4), [600, 610, 9500, 9520]);
    deq(T.sampleFreqs(f, [[500, 700], [11600, 12100]], 100), [600, 610, 620, 11600, 11610]);
    assert.equal(T.sampleFreqs(f, [[500, 700], [9400, 9900], [11600, 12100]], 3).length, 3);
    deq(T.sampleFreqs(f, [[3000, 4000]], 5), []);
    deq(T.sampleFreqs(f, [], 5), []);
    deq(T.sampleFreqs(f, [[500, 700]], 0), []);
  });
  ok("reception: NOAA's feeds are read as UTC, and anything malformed is no reading", () => {
    deq(P.parseFlux([{flux: 127, time_tag: "2026-11-07T20:00:00"}]), {v: 127, at: Date.UTC(2026, 10, 7, 20)});
    deq(P.parseKp([{time_tag: "2026-11-08T06:00:00", Kp: 3}, {time_tag: "2026-11-08T09:00:00", Kp: 3.33}, {time_tag: "2026-11-08T12:00:00", Kp: null}]),
      {v: 3.33, at: Date.UTC(2026, 10, 8, 9)});
    deq(P.parseScales({"0": {DateStamp: "2026-11-08", TimeStamp: "13:21:00", R: {Scale: "2"}}}), {v: 2, at: Date.UTC(2026, 10, 8, 13, 21)});
    for (const bad of [null, {}, [], [{flux: "x", time_tag: "2026-11-07T20:00:00"}], [{flux: 127}], [{flux: 9999, time_tag: "2026-11-07T20:00:00"}], [{flux: null, time_tag: "2026-11-07T20:00:00"}]]) assert.equal(P.parseFlux(bad), null, JSON.stringify(bad));
    assert.equal(P.parseKp([{Kp: 12, time_tag: "2026-11-08T09:00:00"}]), null);
    for (const bad of [null, {}, {"0": {}}, {"0": {R: {Scale: "9"}, DateStamp: "2026-11-08", TimeStamp: "13:21:00"}}, {"0": {R: {Scale: null}, DateStamp: "2026-11-08", TimeStamp: "13:21:00"}}]) assert.equal(P.parseScales(bad), null, JSON.stringify(bad));
  });
  ok("reception: readings expire on their own clocks, and no flux means no estimates", () => {
    const now = at(12), s = new P.SpaceWeather({load: () => ({sfi: {v: 127, at: now - HOUR}, kp: {v: 5, at: now - HOUR}, r: {v: 2, at: now - 10 * 60000}, fetched: now - HOUR})});
    deq(s.current(now), {sfi: 127, kp: 5, kpKnown: true, r: 2, fetched: now - HOUR});
    const later = s.current(now + 2 * HOUR);
    assert.equal(later.r, 0);
    assert.equal(later.kp, 5);
    const quiet = s.current(now + 10 * HOUR);
    assert.equal(quiet.kp, 2);
    assert.equal(quiet.kpKnown, false);
    assert.equal(s.current(now + 72 * HOUR), null);
    assert.equal(new P.SpaceWeather().current(now), null);
    assert.equal(new P.SpaceWeather({load: () => ({sfi: {v: "lots", at: now}})}).current(now), null);
    assert.equal(s.due(now), true);
    assert.equal(s.due(now - 45 * 60000), false);
  });
  {
    const now = at(14), json = {
      "10cm-flux": [{flux: 130, time_tag: "2026-11-08T12:00:00"}],
      "planetary-k": [{Kp: 4, time_tag: "2026-11-08T12:00:00"}],
      "scales": {"0": {DateStamp: "2026-11-08", TimeStamp: "13:00:00", R: {Scale: "0"}}},
    };
    const realFetch = globalThis.fetch;
    let failing = () => false, calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      const key = Object.keys(json).find((k) => url.includes(k));
      if (failing(key)) throw new Error("offline");
      return {ok: true, status: 200, json: async () => json[key]};
    };
    let saved = null, changes = 0;
    const s = new P.SpaceWeather({save: (v) => { saved = JSON.parse(JSON.stringify(v)); }, onChange: () => changes++});
    await s.refresh(now);
    assert.equal(s.current(now).sfi, 130);
    assert.equal(s.current(now).kp, 4);
    assert.equal(changes, 1);
    assert.equal(saved.fetched, now);
    assert.equal(s.due(now + 60000), false);
    await s.refresh(now + 60000);
    assert.equal(changes, 1, "the same values don't redraw the page");
    json["10cm-flux"] = [{flux: 140, time_tag: "2026-11-08T13:00:00"}];
    failing = (k) => k === "planetary-k";
    await s.refresh(now + 120000);
    assert.equal(changes, 2);
    assert.equal(s.current(now).sfi, 140);
    assert.equal(s.current(now).kp, 4, "a feed that fails keeps its last reading");
    const before = calls, one = s.refresh(now + 180000), two = s.refresh(now + 180000);
    await Promise.all([one, two]);
    assert.equal(calls, before + 3, "a refresh under way is shared");
    failing = () => true;
    const fetched = s.state.fetched;
    await s.refresh(now + 240000);
    assert.equal(s.state.fetched, fetched, "nothing read: not counted as fetched");
    globalThis.fetch = realFetch;
    ok("reception: a refresh merges what it could read and only reports real changes", () => {});
  }
  {
    const cal = JSON.parse(fs.readFileSync(new URL("./fixtures/propagation-calibration.json", import.meta.url), "utf8"));
    ok("reception: foF2 follows a week of ionosonde readings", () => {
      const errs = cal.ionosonde.map(([, , fof2, sfi, c]) => P.foF2(c, sfi) - fof2), mean = errs.reduce((a, b) => a + b, 0) / errs.length;
      const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
      assert.ok(cal.ionosonde.length > 400);
      assert.ok(Math.abs(mean) < .5, `bias ${mean}`);
      assert.ok(rmse < 1.7, `rmse ${rmse}`);
      assert.ok(P.foF2(-.9, 127) === P.foF2(-.3, 127), "flat through the night");
      assert.ok(P.foF2(0, 127) > P.foF2(-.3, 127) && P.foF2(.5, 127) > P.foF2(0, 127), "rises with the sun");
      assert.ok(P.foF2(.5, 200) > P.foF2(.5, 100), "and with the flux");
    });
    ok("reception: broadcasters' real schedules fall under the MUF on the bands the model can judge", () => {
      const above = {}, n = {}, skip = new Set(["15m"]);  // too few broadcasts in the sample
      for (const [m, kHz, h, tlat, tlon, rlat, rlon] of cal.broadcasts) {
        const t = Date.UTC(2026, 10, 9) + h * HOUR, e = P.estimate({kHz, rx: {lat: rlat, lon: rlon}, tx: {lat: tlat, lon: tlon}, t, now: t + 1e9, wx: {sfi: 128, kp: 2, r: 0}, aimed: true});
        if (!e || e.muf == null) continue;
        n[m] = (n[m] || 0) + 1;
        if (kHz / 1000 / e.muf > 1.05) above[m] = (above[m] || 0) + 1;
      }
      const limit = {"49m": .15, "41m": .15, "31m": .2, "25m": .25, "22m": .45, "19m": .6, "16m": .55, "13m": .55};
      for (const [m, c] of Object.entries(n)) if (!skip.has(m)) assert.ok((above[m] || 0) / c <= limit[m], `${m}: ${above[m]} of ${c} above the MUF`);
    });
  }
  {
    const KP = [{time_tag: "2026-11-08T12:00:00", kp: 3, observed: "observed"}, {time_tag: "2026-11-08T15:00:00", kp: 4, observed: "estimated"},
      {time_tag: "2026-11-08T18:00:00", kp: 6, observed: "predicted"}, {time_tag: "2026-11-08T21:00:00", kp: "bad", observed: "predicted"}];
    const SC = {"0": {R: {Scale: "0"}}, "1": {DateStamp: "2026-11-08", R: {MinorProb: "60", MajorProb: "15"}}, "2": {DateStamp: "2026-11-09", R: {MinorProb: null}}, "3": {DateStamp: "x", R: {MinorProb: "1", MajorProb: "1"}}};
    const TXT = "# head\n#  Date\n2026 Nov 09     125          15          4\n2026 Nov 10     140          10          3\n2026 Foo 11     120          10          3\n2026 Nov 12     900          10          3\n";
    ok("reception: NOAA's forecasts are read, and what's malformed is left out", () => {
      deq(P.parseKpForecast(KP), [{v: 4, at: Date.UTC(2026, 10, 8, 15)}, {v: 6, at: Date.UTC(2026, 10, 8, 18)}]);
      deq(P.parseRisk(SC), [{at: Date.UTC(2026, 10, 8), minor: 60, major: 15}]);
      deq(P.parseOutlook(TXT), [{at: Date.UTC(2026, 10, 9), sfi: 125}, {at: Date.UTC(2026, 10, 10), sfi: 140}]);
      for (const bad of [null, {}, "x", 3]) { deq(P.parseKpForecast(bad), []); deq(P.parseRisk(bad === "x" ? null : bad), []); }
      deq(P.parseOutlook(null), []);
    });
    ok("reception: a moment's solar data: measured near now, the forecast later, a quiet sun before", () => {
      const now = at(14), s = new P.SpaceWeather({load: () => ({sfi: {v: 127, at: now - HOUR}, kp: {v: 2, at: now - HOUR}, r: {v: 1, at: now - 60000},
        forecast: {kp: [{v: 6, at: at(18)}], risk: [{at: DAY0, minor: 60, major: 15}], flux: [{at: DAY0 + 24 * HOUR, sfi: 140}]}})});
      deq(s.at(now + HOUR, now), s.current(now));
      const storm = s.at(at(19), now);
      assert.equal(storm.kp, 6); assert.equal(storm.kpKnown, true); assert.equal(storm.r, 0, "the odds of a blackout aren't a blackout"); assert.equal(storm.sfi, 127);
      assert.equal(s.at(at(26), now).sfi, 140);
      assert.equal(s.at(at(26), now).kpKnown, false);
      assert.equal(s.at(at(2), now).kp, 2); assert.equal(s.at(at(2), now).r, 0);
      assert.equal(new P.SpaceWeather().at(now, now), null);
      deq(s.risk(now), {at: DAY0, minor: 60, major: 15});
      assert.equal(s.risk(at(30)), null);
    });
    ok("reception: the grid has a cell per band and hour, starts at the present and says what half the regions reach", () => {
      const now = at(14) + 20 * 60000, seen = [], bands = [["41m", 7200, 7600], ["19m", 15100, 15800]];
      const g = P.bandGrid({rx: RX, bands, now, wxAt: (t) => { seen.push(t); return wx; }});
      assert.equal(g.rows.length, 2); assert.equal(g.rows[0].cells.length, 24); assert.equal(g.sun.length, 24);
      assert.equal(seen[0], now, "the first column is the present");
      assert.equal(seen[1], at(15) + HOUR / 2, "the others the middle of their hour");
      assert.equal(g.start, at(14));
      const one = (id) => P.bandGrid({rx: RX, bands, now, wxAt: () => wx, paths: P.GRID_PATHS.filter((p) => p.id === id)});
      const RANK = {likely: 2, possible: 1, unlikely: 0};
      g.rows.forEach((r, b) => r.cells.forEach((c, i) => {
        const alone = P.GRID_PATHS.map((p) => ({id: p.id, ...one(p.id).rows[b].cells[i]})), third = alone.map((x) => RANK[x.tier]).sort((m, n) => n - m)[2];
        assert.equal(RANK[c.tier], third, "the third of six regions decides");
        deq([...c.open].sort(), alone.filter((x) => x.tier !== "unlikely").map((x) => x.id).sort());
      }));
      deq(one("eur").rows[0].cells[0].path, "eur");
      assert.ok(one("eur").rows[0].cells[0].reasons[0].startsWith("MUF"));
      deq(P.bandGrid({rx: RX, bands, now, wxAt: () => null}).rows[0].cells[0], null);
    });
    ok("reception: the grid's summary says what's open and what opens next", () => {
      const row = (name, tiers) => ({name, cells: [...tiers].map((c) => c === "-" ? null : {tier: {L: "likely", P: "possible", U: "unlikely"}[c]})});
      const g = (...rows) => ({hours: rows[0].cells.length, rows});
      deq(P.gridSummary(g(row("49m", "LLU"), row("31m", "UUL"), row("19m", "PLU"))), {now: ["49m"], next: {band: "19m", col: 1}});
      deq(P.gridSummary(g(row("49m", "UU-"))), {now: [], next: null});
    });
    {
      const now = at(14), realFetch = globalThis.fetch;
      let calls = 0, changes = 0, saved = null, fail = false;
      globalThis.fetch = async (url) => {
        calls++;
        if (fail) throw new Error("offline");
        const body = url.includes("forecast") ? KP : url.includes("scales") ? SC : url.includes("10cm") ? [{flux: 130, time_tag: "2026-11-08T12:00:00"}] : url.includes("planetary") ? [{Kp: 2, time_tag: "2026-11-08T12:00:00"}] : null;
        return {ok: true, status: 200, json: async () => body, text: async () => TXT};
      };
      const s = new P.SpaceWeather({save: (v) => { saved = JSON.parse(JSON.stringify(v)); }, onChange: () => changes++});
      await s.refresh(now);
      assert.equal(calls, 6);
      assert.equal(saved.forecast.kp.length, 2); assert.equal(saved.forecast.flux.length, 2);
      assert.equal(changes, 1);
      await s.refresh(now + 30 * 60000);
      assert.equal(calls, 9, "forecasts aren't read at every refresh");
      fail = true;
      await s.refresh(now + 7 * HOUR);
      assert.equal(s.state.forecast.kp.length, 2, "a failed read keeps the last forecast");
      globalThis.fetch = realFetch;
      deq(new P.SpaceWeather({load: () => saved}).state.forecast, saved.forecast);
      assert.deepEqual(new P.SpaceWeather({load: () => ({forecast: {kp: "x"}})}).state.forecast, {kp: [], risk: [], flux: []});
      ok("reception: forecasts are refreshed apart, kept when a read fails, and restored", () => {});
    }
  }
}
console.log(`\n${n} checks passed`);
