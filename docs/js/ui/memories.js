import {pad2} from "../protocol.js";
import {dur, flagHtml, fmtKHz, fmtShift, hhmmMin, ituFlag, minHHMM, span, swOnAir, toKHz} from "../radiomap.js";
import {CancelErr, MAX_CH, MEM_BANDS, MemoryRun, SW_METERS, addToList, nearestStations, backupText, bandCount, bandFor, bandRange, bandSummary, freqText, memKey, parseMemList, pool, recordItems} from "../memories.js";
import {waiters} from "../state.js";
import {errText} from "../link.js";
import {$, BAND_COLORS, ask, bandIco, esc, log, state, toast} from "./shell.js";
import {dossierName, hhmm, isRepeater, locate, mem, myPos, myRegion, myTargets, placeOf, radius, renderView, rm, show, store, view} from "./radio.js";
import {link, setWake} from "./more.js";
import {swipeRows} from "./gestures.js";

// ---- Memories tab ----
export const memNote = (text) => log({kind: "mem", text, raw: new Uint8Array()});
export const saveMem = () => store.set("rf919.memlist", mem.list);
// The record follows the link: No radio's virtual radio has its own (shell.js setStatus swaps it), so the two never mix
export const saveRecord = () => store.set(mem.recordKey, mem.record);
export const bandStyle = (band) => `--band:${BAND_COLORS[band] || "#b0bec5"}`;
export const memSecs = (n) => { const s = Math.round(n * 2.5); return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`; };

// Adds to the list (never more than MAX_CH per band) and says what was added and what didn't fit
export function addMem(items) {
  if (mem.run) { toast("Wait until the run is over", 3000, true); return; }
  const old = mem.list, {list, errors} = addToList(old, items);
  const fresh = list.filter((e) => !old.includes(e));
  mem.list = list;
  saveMem();
  const bands = new Set(fresh.map((e) => e.band));
  if (bands.size === 1 && !bands.has(shownBand())) mem.viewBand = [...bands][0];
  const first = fresh[0];
  let msg = fresh.length === 1 ? `Added ${first.band} ${fmtKHz(first.kHz)} → CH ${first.ch}${first.name ? ` · ${first.name}` : ""}`
    : fresh.length ? `Added ${fresh.length} memories` : "Nothing added";
  if (errors.length) msg += `\n${errors.length === 1 ? errors[0].msg : `${errors.length} didn't fit: ${errors[0].msg}`}`;
  toast(msg, errors.length ? 5000 : 3000, !fresh.length);
  renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
}

// The Memories tab works on one band: the one picked in its tabs, else the radio's, else the first in the list
export const radioMemBand = () => waiters.freq && MEM_BANDS.includes(waiters.freq.band) ? waiters.freq.band : null;
export function shownBand() {
  return mem.viewBand || radioMemBand() || MEM_BANDS.find((b) => bandCount(mem.list, b)) || "FM";
}
export const BAND_EXAMPLES = {FM: "1 101.3 Radio Uno\n2 99.9", AM: "1 720\n2 1140 Radio Uno", SW: "1 5025\n2 6000 Radio Uno",
  AIR: "1 118.1 Torre\n2 121.9", CB: "1 27.185", UHF: "1 433.275 Repetidor", VHF: "1 146.730 Repetidor\n2 145.5", LW: "1 153"};

export function renderMem() {
  const band = shownBand(), list = mem.list, running = !!mem.run, radio = radioMemBand();
  const rows = list.map((e, i) => [e, i]).filter(([e]) => e.band === band), n = rows.length;
  $("mem-total").textContent = `${band} · ${n}/${MAX_CH}`;
  // A segmented control of native radio buttons; every band gets one, so an empty band can be started too
  $("mem-counts").innerHTML = `<legend>Band</legend>` + MEM_BANDS.map((b) => {
    const c = bandCount(list, b);
    return `<label class="${c >= MAX_CH ? "full" : ""}"><input type="radio" name="memband" value="${b}"${b === band ? " checked" : ""}${running ? " disabled" : ""}>` +
      `<span>${b === radio ? `<i class="lit" title="The radio's band"></i>` : ""}${bandIco(b)}${b} · ${c}</span></label>`;
  }).join("");
  // Edit as text works on this band too; text and errors typed for another band don't carry over
  if (mem.textBand !== band) { mem.textBand = band; $("mem-text").value = ""; $("mem-errs").textContent = ""; }
  $("mem-text-sum").textContent = `Edit ${band} as text`;
  $("mem-text-show").textContent = `Show ${band} as text`;
  $("mem-text-apply").textContent = `Replace ${band} list`;
  $("mem-text-append").textContent = `Add to ${band} list`;
  $("mem-text").placeholder = BAND_EXAMPLES[band] || "";
  $("mem-text-hint").textContent = `One memory per line: channel, frequency, name, for the ${band} list. The channel is optional ` +
    `(a missing one takes the next free channel); a line for another band needs its band name, as in "FM 101.3". At most ${MAX_CH}.`;
  const checked = mem.check && mem.check.byKey;
  // A row: the channel, the name over the frequency (or the frequency alone), and ✕; on touch, swiping it left
  // uncovers Delete (gestures.js swipeRows)
  const dis = running ? " disabled" : "";
  $("mem-list").innerHTML = n ? rows.map(([e, i]) => {
    const st = checked && checked.get(memKey(e.band, e.ch));
    const cls = running && (mem.kind === "store" || mem.kind === "check") && e === (mem.jobRows || [])[mem.pos] ? "cur" : st === "ok" ? "ok" : st ? "bad" : "";
    const sub = [e.name && fmtKHz(e.kHz), st && st !== "ok" && st.replace(/^· /, "")].filter(Boolean).join(" · ");
    return `<li class="mem-row ${cls}"><div class="mr-fg"><span class="ch">${e.ch}</span>` +
      `<span class="mr-main"><b>${e.name ? esc(e.name) : fmtKHz(e.kHz)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>` +
      `<button class="mr-del" type="button" data-mem="del" data-i="${i}" aria-label="Remove ${e.band} CH ${e.ch}"${dis}>✕</button></div>` +
      `<button class="mr-act" type="button" data-mem="del" data-i="${i}" tabindex="-1" aria-hidden="true"${dis}>Delete</button></li>`;
  }).join("") : `<li class="empty-row"><b>No ${band} memories yet</b><span>Add some with + Memory under a frequency, ` +
    `Store here on Radio, or the tools below.</span></li>`;
  renderMemRun();
}

// What each kind of job runs over, and how it names a step
// Store and check run over the shown band's rows, as they were when the job started (so Resume finds them)
export const JOBS = {
  store: {verb: "Storing", noun: "row", items: () => mem.jobRows || []},
  check: {verb: "Checking", noun: "row", items: () => mem.jobRows || []},
  wipe: {verb: "Wiping", noun: "band", items: () => mem.wipeItems || []},
  next: {verb: "Storing", noun: "station", items: () => mem.nextItems || []},  // Store here
};
export const selRows = () => { const band = shownBand(); return mem.list.filter((e) => e.band === band); };
export const jobLabel = (kind, it) => kind === "wipe" ? it.band : kind === "next" ? `${it.band} ${fmtKHz(it.kHz)} → next channel` : `${it.band} ${fmtKHz(it.kHz)} → CH ${it.ch}`;

export function renderMemRun() {
  const box = $("mem-run"), band = shownBand(), list = selRows(), n = list.length;
  box.classList.toggle("running", !!mem.run);  // stays in view, over the list, while it runs
  let h = `<h2 class="h"><span>Store on the radio · ${band}</span><span>${n ? `${n} · ≈${memSecs(n)}` : ""}</span></h2>`;
  if (mem.run) {
    const job = JOBS[mem.kind], items = job.items(), total = items.length, i = mem.pos, e = items[i], todo = total - mem.from;
    const avg = mem.done ? (Date.now() - mem.t0) / mem.done / 1000 : mem.kind === "wipe" ? 3 : 2.5;
    h += `<div class="progress"><i style="width:${todo ? mem.done / todo * 100 : 0}%"></i></div>` +
      `<p class="hint" style="margin-top:0">${job.verb} ${i + 1}/${total}` +
      (e ? ` · ${esc(jobLabel(mem.kind, e))}` : "") + (mem.step ? ` · ${esc(mem.step)}` : "") +
      ` · ≈${Math.max(1, Math.round(avg * (total - i)))} s left</p>` +
      `<div class="row"><button class="small danger" type="button" data-mem="stop">Stop</button></div>` +
      `<p class="hint">Keep this page open and don't touch the radio until it's done.</p>`;
    box.innerHTML = h;
    return;
  }
  const over = list.filter((e) => { const r = mem.record[memKey(e.band, e.ch)]; return r && r.kHz !== e.kHz; });
  if (over.length) {
    h += `<p class="hint" style="margin-top:0">Replaces, per this app's record: ` +
      over.slice(0, 8).map((e) => `${e.band} CH ${e.ch} (${freqText(mem.record[memKey(e.band, e.ch)].kHz)} → ${freqText(e.kHz)})`).join(", ") +
      (over.length > 8 ? ` and ${over.length - 8} more` : "") + `. The radio overwrites a channel without asking.</p>`;
  }
  const off = !state.ok || !n ? " disabled" : "";
  h += `<div class="row" style="margin-top:8px"><button class="filled" type="button" data-mem="store"${off}>Store${n ? ` ${n}` : ""}</button>` +
    `<button type="button" data-mem="check"${off}>Check${n ? ` ${n}` : ""}</button></div>` +
    (n ? `<div class="row" style="margin-top:var(--s2)"><button class="small quiet" type="button" data-mem="clear">Clear the ${band} list</button></div>` : "");
  if (mem.fail) {
    h += `<p class="errs">${esc(mem.fail.msg)}</p><div class="row" style="margin-top:8px">` +
      `<button class="small" type="button" data-mem="resume">Resume from ${JOBS[mem.fail.kind].noun} ${mem.fail.i + 1}</button></div>`;
  }
  if (mem.check && !mem.run) {
    const c = mem.check;
    h += `<p class="hint">Checked ${c.n}: ${c.ok} match${c.bad ? ` · ${c.bad} differ or didn't answer (marked in the list)` : ""}.</p>`;
  }
  if (!state.ok) h += `<p class="hint">Connect the radio, or choose No radio, to store the list. About 2–3 s per memory; keep the screen on and don't touch the radio during a run.</p>`;
  box.innerHTML = h;
  renderFresh();
  renderBackup();
}

// kind "store": store rows from..end. "check": recall them and compare with the list.
// "wipe": wipe the bands in mem.wipeItems on the radio, then forget them in the app
export async function runJob(kind, from = 0) {
  if (mem.run || !state.ok || !link) return;
  if (kind !== "wipe" && !from) mem.jobRows = selRows();
  const job = JOBS[kind], list = job.items();
  if (!list.length) return;
  const run = mem.run = new MemoryRun(link, waiters, {note: memNote});
  Object.assign(mem, {kind, from, pos: from, done: 0, step: "", t0: Date.now(), fail: null});
  if (kind === "store") mem.check = null;
  else if (kind === "check" && (!from || !mem.check)) mem.check = {n: 0, ok: 0, bad: 0, byKey: new Map()};
  const wakeWasOn = $("wake").checked;
  if (!wakeWasOn && "wakeLock" in navigator) setWake(true, true);
  memNote(`── ${job.verb.toLowerCase()} ${job.noun}s ${from + 1}–${list.length}`);
  renderMem();
  try {
    for (let i = from; i < list.length; i++) {
      const e = list[i], key = memKey(e.band, e.ch);
      const onStep = (step) => { mem.step = step; renderMemRun(); };
      mem.pos = i; mem.step = "";
      renderMem();
      if (kind === "store") {
        await run.store(e, onStep);
        mem.record[key] = {kHz: e.kHz, name: e.name, at: Date.now()};
        saveRecord();
      } else if (kind === "check") {
        onStep("recall");
        const r = await run.recall(e.band, e.ch), c = mem.check;
        c.n++;
        if (r.kHz === e.kHz) { c.ok++; c.byKey.set(key, "ok"); }
        else { c.bad++; c.byKey.set(key, r.empty ? "· empty" : r.kHz === null ? "· no reply" : `· radio has ${freqText(r.kHz)}`); }
        if (r.empty) delete mem.record[key];
        else if (r.kHz !== null) mem.record[key] = {kHz: r.kHz, name: r.kHz === e.kHz ? e.name : "", at: Date.now()};
        saveRecord();
      } else {
        await run.wipe(e.band, e.probe, onStep);
        forgetBand(e.band);  // only once the radio has done it
      }
      mem.done++;
    }
    toast(kind === "store" ? `Stored ${mem.done} memor${mem.done === 1 ? "y" : "ies"}`
      : kind === "check" ? `Checked: ${mem.check.ok}/${mem.check.n} match` : `Wiped ${list.map((e) => e.band).join(", ")}`);
  } catch (err) {
    const e = list[mem.pos], where = `${job.noun} ${mem.pos + 1}${e ? ` (${jobLabel(kind, e)})` : ""}`;
    const stopped = err instanceof CancelErr;
    mem.fail = {kind, i: mem.pos, msg: `${stopped ? "Stopped" : "Failed"} at ${where}${mem.step ? `, step "${mem.step}"` : ""}` +
      (stopped && err.message === "stopped" ? "" : `: ${err.message || err}`)};
    memNote(`── ${mem.fail.msg}`);
  } finally {
    mem.run = null; mem.step = "";
    if (!wakeWasOn && state.wake) setWake(false, true);
    renderMem(); renderView();
  }
}

// ---- Store here: what the radio is on, on the channel after the last one in use ----
// f: the radio's frequency (waiters.freq; passed by the freq handler, which runs before waiters is fed)
// Store here's button is in the card (radio.js actionsHtml), which asks canStoreHere when it renders
export const canStoreHere = (f = waiters.freq) => state.ok && !mem.run && !!f && !f.alert && !!toKHz(f) && MEM_BANDS.includes(f.band);
export function renderStoreHere(f = waiters.freq) {
  // The Memories tab follows the radio: a band change on the radio brings the view to it
  const rb = f && MEM_BANDS.includes(f.band) ? f.band : null;
  if (rb && rb !== mem.radioBand) { mem.radioBand = rb; mem.viewBand = null; renderMem(); }
}
export async function storeHere() {
  const f = waiters.freq, k = f && toKHz(f), band = f && f.band;
  if (mem.run || !state.ok || !link || !k || !MEM_BANDS.includes(band)) return;
  const had = Object.entries(mem.record).find(([key, r]) => key.startsWith(band + ":") && r.kHz === k);
  if (had && !await ask({title: `Already on ${band} CH ${had[0].split(":")[1]}`, body: `${fmtKHz(k)} is stored there. Store it again, on the next channel?`, ok: "Store again"})) return;
  const name = view.k === k && view.data ? dossierName() : "";
  // Never overwrite a channel this app knows holds something else (a radio that wraps round when the band is full)
  const guard = (n) => { const r = mem.record[memKey(band, n)]; return r && r.kHz !== k ? `the radio proposes CH ${n}, which holds ${fmtKHz(r.kHz)} per this app's record` : null; };
  mem.run = new MemoryRun(link, waiters, {note: memNote});
  Object.assign(mem, {kind: "next", nextItems: [{band, kHz: k}], from: 0, pos: 0, done: 0, step: "", t0: Date.now()});
  renderMem(); renderView();
  toast(`Storing ${fmtKHz(k)} on the next ${band} channel…`, 8000);
  try {
    const n = await mem.run.storeNext(band, guard);
    mem.record[memKey(band, n)] = {kHz: k, name, at: Date.now()};
    saveRecord();
    const clash = mem.list.find((e) => e.band === band && e.ch === n && e.kHz !== k);
    if (!clash && !mem.list.some((e) => e.band === band && e.ch === n)) { mem.list = addToList(mem.list, [{band, kHz: k, ch: n, name}]).list; saveMem(); }
    toast(`Stored ${fmtKHz(k)} on ${band} CH ${n}${name ? ` · ${name}` : ""}` +
      (clash ? `\nYour list plans ${freqText(clash.kHz)} on CH ${n}; storing the list would replace it` : ""), clash ? 7000 : 4000);
  } catch (err) {
    const msg = err instanceof CancelErr ? "Stopped" : err.message || String(err);
    toast(`Not stored: ${msg}\nThe radio leaves store mode by itself in a few seconds.`, 7000, true);
    memNote(`── store next ${band}: not stored: ${msg}`);
  } finally {
    mem.run = null;
    renderMem(); renderView();
  }
}

// ---- Backup: export the app's record as text, import one back ----
export const SHARE_FILES = (() => {
  try { return !!(navigator.canShare && navigator.canShare({files: [new File(["x"], "x.txt", {type: "text/plain"})]})); }
  catch { return false; }
})();
export const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export function backupFile() {
  const when = localStamp();
  return {name: `rf919-memories-${when.slice(0, 10)}.txt`, text: backupText(mem.record, when)};
}

export function renderBackup() {
  const rows = recordItems(mem.record), n = rows.length, off = !n ? " disabled" : "", p = mem.imported;
  let h = `<p class="hint" style="margin-top:0">` + (n
    ? `${n} channel${n === 1 ? "" : "s"} this app knows are on the radio: ${esc(bandSummary(rows))}.`
    : "Nothing to export yet: the app's record fills up as you Store, use Store here or Check on radio.") + `</p>` +
    `<div class="row">` + (SHARE_FILES ? `<button class="small primary" type="button" data-mem="bk-share"${off}>Share backup</button>` : "") +
    `<button class="small" type="button" data-mem="bk-download"${off}>Download .txt</button></div>` +
    `<h2 class="h" style="margin:16px 0 8px"><span>Import</span></h2>` +
    `<div class="row"><button class="small" type="button" data-mem="bk-open"${mem.run ? " disabled" : ""}>Open backup file…</button></div>`;
  if (p && p.errors.length) {
    h += `<p class="errs">${esc(p.name)}: ` + p.errors.slice(0, 8).map((x) => esc(`${x.line ? `line ${x.line}: ` : ""}${x.msg}`)).join("<br>") +
      (p.errors.length > 8 ? `<br>… and ${p.errors.length - 8} more` : "") + `</p>`;
  } else if (p) {
    const dis = mem.run ? " disabled" : "";
    h += `<p class="hint">${esc(p.name)}: ${p.list.length} channel${p.list.length === 1 ? "" : "s"} · ${esc(bandSummary(p.list))}</p>` +
      `<div class="row" style="margin-top:8px"><button class="small primary" type="button" data-mem="bk-load"${dis}>Load to store</button>` +
      `<button class="small" type="button" data-mem="bk-mark"${dis}>Already on radio</button></div>` +
      `<p class="hint"><b>Load to store</b>: the radio was wiped or reset; the file becomes the list, then tap Store. ` +
      `<b>Already on radio</b>: the radio still has them (new phone or browser); the app just learns them, nothing is sent.</p>`;
  }
  $("backup-body").innerHTML = h;
}

export async function exportBackup(share) {
  const {name, text} = backupFile();
  if (share) {
    try { await navigator.share({files: [new File([text], name, {type: "text/plain"})], title: "RF919 memories"}); }
    catch (e) { if (e.name !== "AbortError") toast(`Share failed: ${errText(e)}`, 4000, true); }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], {type: "text/plain"})), a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Saved ${name}`);
}

export async function readBackup(file) {
  if (file.size > 1e6) { mem.imported = {name: file.name, list: [], errors: [{msg: "too big for a memory list"}]}; renderBackup(); return; }
  let text;
  try { text = await file.text(); } catch (e) { toast(`Couldn't read ${file.name}: ${errText(e)}`, 4000, true); return; }
  const {entries, errors} = parseMemList(text);
  const res = errors.length ? {list: [], errors: []} : addToList([], entries);
  const all = [...errors, ...res.errors];
  if (!all.length && !res.list.length) all.push({msg: "no memories in this file"});
  mem.imported = {name: file.name, list: res.list, errors: all};
  renderBackup();
}

// mark: the radio already holds these, so the app's record learns them; otherwise they only become the list to store
export async function importBackup(mark) {
  const p = mem.imported;
  if (!p || p.errors.length || mem.run) return;
  if (mark) {
    const changed = p.list.filter((e) => { const r = mem.record[memKey(e.band, e.ch)]; return r && r.kHz !== e.kHz; });
    if (changed.length) {
      const e = changed[0], old = mem.record[memKey(e.band, e.ch)].kHz;
      if (!await ask({title: "Update the app's record?", body: `This changes ${changed.length} channel${changed.length === 1 ? "" : "s"} it knows, ` +
        `for example ${e.band} CH ${e.ch}: ${freqText(old)} → ${freqText(e.kHz)}.`, ok: "Update"})) return;
    }
    const at = Date.now();
    for (const e of p.list) mem.record[memKey(e.band, e.ch)] = {kHz: e.kHz, name: e.name, at};
    saveRecord();
  }
  const n = p.list.length;
  Object.assign(mem, {list: p.list, check: null, fail: null, imported: null});
  saveMem();
  toast(mark ? `The app now knows ${n} channel${n === 1 ? "" : "s"} on the radio` : `${n} memor${n === 1 ? "y" : "ies"} loaded: tap Store to put them on the radio`, 4500);
  renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
}

// The app's side of a wipe: the band's rows in the list, its record, and its check marks
export function forgetBand(band) {
  const mine = (k) => k.startsWith(band + ":");
  for (const k of Object.keys(mem.record)) if (mine(k)) delete mem.record[k];
  if (mem.check) for (const k of [...mem.check.byKey.keys()]) if (mine(k)) mem.check.byKey.delete(k);
  mem.list = mem.list.filter((e) => e.band !== band);
  saveRecord(); saveMem();
  renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
}
export const recordedIn = (band) => Object.keys(mem.record).filter((k) => k.startsWith(band + ":")).map((k) => +k.split(":")[1]);
// The channel to recall after a wipe: the lowest one known to have held something, so an empty reply means something
export function probeChannel(band) {
  const chs = [...recordedIn(band), ...mem.list.filter((e) => e.band === band).map((e) => e.ch)];
  return chs.length ? Math.min(...chs) : 1;
}

export function renderFresh() {
  const band = shownBand();
  $("fresh-sum").textContent = `Start fresh: wipe ${band}`;
  $("fresh-body").innerHTML =
    `<p class="hint" style="margin-top:0">Deletes every ${band} memory (CH 1–${MAX_CH}) on the radio, as holding SCAN/ATS on it does, ` +
    `then clears this app's ${band} list and record. Other bands are kept.</p>` +
    `<div class="row"><button class="danger" type="button" data-mem="fresh"${!state.ok || mem.run ? " disabled" : ""}>` +
    `Wipe all ${band} memories on the radio</button></div>` +
    (state.ok ? "" : `<p class="hint">Connect the radio, or choose No radio, first.</p>`);
}
export async function startFresh() {
  const band = shownBand();
  if (mem.run || !state.ok) return;
  if (!await ask({title: `Wipe all ${band} memories?`, body: `Deletes every ${band} memory on the radio, and this app's ${band} list and record. This can't be undone.`, ok: `Wipe ${band}`, danger: true})) return;
  mem.wipeItems = [{band, probe: probeChannel(band)}];
  runJob("wipe");
}

export function applyText(replace) {
  if (mem.run) return;
  const show = (errs) => {
    $("mem-errs").innerHTML = errs.slice(0, 12).map((x) => esc(`${x.line ? `line ${x.line}: ` : ""}${x.msg}`)).join("<br>") +
      (errs.length > 12 ? `<br>… and ${errs.length - 12} more` : "");
  };
  const band = shownBand(), r = bandRange(band);
  const {entries, errors} = parseMemList($("mem-text").value, band);
  for (const e of entries) {
    if (e.band !== band) errors.push({line: e.line, msg: `${e.band} line in the ${band} list; switch to ${e.band} to edit it`});
    else if (!e.named && r && (e.kHz < r[1] || e.kHz > r[2])) {
      const other = bandFor(e.kHz);
      errors.push({line: e.line, msg: `${fmtKHz(e.kHz)} isn't in the ${band} band` +
        (other ? `; write ${other} ${freqText(e.kHz)} or switch to ${other}` : "")});
    }
  }
  if (errors.length) { show(errors.sort((a, b) => a.line - b.line)); return; }
  // Only this band's rows change; the other bands are kept as they are
  const others = mem.list.filter((e) => e.band !== band);
  const res = addToList(replace ? others : mem.list, entries);
  if (res.errors.length) { show(res.errors); return; }
  show([]);
  Object.assign(mem, {list: res.list, check: null, fail: null});
  saveMem();
  $("mem-text").value = "";
  toast(replace ? `The ${band} list now has ${bandCount(mem.list, band)} memories` : `Added ${entries.length} ${band} memor${entries.length === 1 ? "y" : "ies"}`);
  renderMem(); renderPicks("sw"); renderPicks("near"); renderView();
}

// ---- list builders (radiomap.cl has one file per frequency, so they fetch a few at a time) ----
// One job per key ("mem": the memories tools; Explore's Discover has its own), so neither cancels the other
export const jobs = {};
export async function fetchAll(ks, box, key = "mem") {
  if (jobs[key]) jobs[key].abort();
  const ctl = jobs[key] = new AbortController();
  if (key === "mem") mem.job = ctl;
  box.innerHTML = `<div class="progress"><i style="width:0"></i></div>` +
    `<p class="hint" style="margin-top:0"><span></span> <button class="small" type="button" data-mem="job-stop" data-job="${key}">Cancel</button></p>`;
  const bar = box.querySelector(".progress i"), txt = box.querySelector("p span");
  const prog = (d, n) => { bar.style.width = `${d / n * 100}%`; txt.textContent = `Fetching ${d}/${n} from radiomap.cl…`; };
  prog(0, ks.length);
  // rm.get, not rm.lookup: a long list mustn't push the dossier's lookups out of the cache
  const got = await pool(ks, 6, (k) => rm.get(`freq/${k}.json`), prog, ctl.signal);
  // A job replaced by a newer one leaves the box alone: it holds the new job's progress by now
  const latest = jobs[key] === ctl;
  if (latest) jobs[key] = null;
  if (mem.job === ctl) mem.job = null;
  if (ctl.signal.aborted) { if (latest) box.innerHTML = `<p class="hint">Cancelled.</p>`; return null; }
  return got;
}
export async function radiomapIndex(box) {
  try { return await rm.index(); }
  catch (e) { box.innerHTML = `<p class="errs">radiomap.cl unreachable (${esc(errText(e))})</p>`; return null; }
}
export function renderSwChips() {
  const chip = (id, label) => `<label><input type="checkbox" data-swband value="${id}"${mem.swSel.has(id) ? " checked" : ""}><span>${label}</span></label>`;
  $("sw-bands").innerHTML = `<legend>Meter bands</legend>` + SW_METERS.map(([m]) => chip(m, m)).join("") + chip("all", "All SW");
  $("sw-aimed-row").hidden = !myPos;
  $("sw-aimed-name").textContent = myRegion();
}

export async function swFind() {
  const box = $("sw-results"), all = mem.swSel.has("all"), meters = SW_METERS.filter(([m]) => mem.swSel.has(m));
  if (!all && !meters.length) { toast("Pick one or more meter bands", 3000, true); return; }
  const idx = await radiomapIndex(box);
  if (!idx) return;
  const ks = idx.freqs.filter((k) => bandFor(k) === "SW" && (all || meters.some(([, lo, hi]) => k >= lo && k <= hi)));
  if (ks.length > 300 && !await ask({title: `Fetch ${ks.length} frequencies?`, body: "radiomap.cl has one file per frequency, so this takes a while.", ok: "Fetch"})) return;
  const got = await fetchAll(ks, box);
  if (!got) return;
  const aimed = !!myPos && $("sw-aimed").checked;
  const items = swOnAir(ks.map((k, i) => [k, got[i]]), {win: +$("sw-window").value, targets: aimed ? myTargets : null}).map(({k, e, air}) =>
    ({band: "SW", kHz: k, ch: null, name: e.station || "", flag: flagHtml(ituFlag(e.itu), e.country),
      note: [e.langLabel || e.lang, air.on ? `on air until ${minHHMM(hhmmMin(e.endUTC))} UTC` : `from ${hhmm(e.startUTC)} UTC, in ${dur(air.startsIn)}`]
        .filter(Boolean).join(" · ")}));
  mem.picks.sw = {band: "SW", items, failed: got.filter((d) => d === null).length};
  renderPicks("sw");
}

export async function nearFind() {
  const box = $("near-results"), band = $("near-band").value, kind = $("near-kind").value, radius = +$("near-radius").value;
  if (radius && !myPos) { try { await locate(); } catch { return; } }
  const idx = await radiomapIndex(box);
  if (!idx) return;
  const ks = idx.freqs.filter((k) => bandFor(k) === band);
  if (!ks.length) { box.innerHTML = `<p class="hint">radiomap.cl has nothing on ${band}.</p>`; return; }
  const got = await fetchAll(ks, box);
  if (!got) return;
  const items = nearestStations(ks.map((k, i) => [k, got[i]]), {band, kind, pos: myPos, radius}).map(({k, s, km}) =>
    ({band, kHz: k, ch: null, km, name: s.nombre || s.signal || "",
      note: [s.nombre && s.signal, isRepeater(s) && `repeater ${fmtShift(s.rxKHz, s.txKHz)}`, placeOf(s)[0],
        km != null && `${Math.round(km).toLocaleString()} km`].filter(Boolean).join(" · ")}));
  mem.picks.near = {band, items, failed: got.filter((d) => d === null).length};
  renderPicks("near");
}

// The builder's results with tick boxes; only as many are ticked as the band has free channels
export function renderPicks(kind) {
  const p = mem.picks[kind], box = $(`${kind}-results`);
  if (!p) return;
  const inList = (it) => mem.list.some((e) => e.band === it.band && e.kHz === it.kHz);
  const free = MAX_CH - bandCount(mem.list, p.band);
  const fit = Math.min(p.items.filter((it) => !inList(it)).length, free);
  let ticked = 0;
  const rows = p.items.map((it, i) => {
    const has = inList(it), on = !has && ticked < free;
    if (on) ticked++;
    return `<label class="${has ? "in" : ""}"><input type="checkbox" data-pick="${i}"${on ? " checked" : ""}${has ? " disabled" : ""}>` +
      `<b>${freqText(it.kHz)}</b><span>${it.flag || ""}${esc(it.name)}<small>${esc(has ? "already in the list" : it.note || "")}</small></span></label>`;
  }).join("");
  const head = `${p.items.length} match · ${fit} fit (${free} free ${p.band} channel${free === 1 ? "" : "s"} of ${MAX_CH})` +
    (p.failed ? ` · ${p.failed} couldn't be fetched` : "");
  box.innerHTML = `<p class="hint">${esc(head)}</p>` + (p.items.length
    ? `<div class="picks mem-box">${rows}</div><div class="row" style="margin-top:8px">` +
      `<button class="small primary" type="button" data-mem="add-${kind}">Add ticked</button></div>` : "");
}
export function addPicked(kind) {
  const p = mem.picks[kind];
  const items = [...$(`${kind}-results`).querySelectorAll("input[data-pick]:checked")].map((b) => p.items[+b.dataset.pick]);
  if (!items.length) { toast("Tick some first", 2500, true); return; }
  addMem(items.map(({band, kHz, name}) => ({band, kHz, ch: null, name})));
}

// What ran at load in the single-script page, in the same order; app.js calls it once every module is loaded
export function init() {

  mem.swSel = new Set(store.get("rf919.swbands", ["49m", "41m", "31m", "25m"]));
  swipeRows($("mem-list"));
}
